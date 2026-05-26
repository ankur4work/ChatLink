// @ts-check
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify, { PLAN_NAME, PLAN_AMOUNT, PLAN_TRIAL_DAYS } from "./shopify.js";
import cancelSubscription from "./cancel-subscription.js";
import GDPRWebhookHandlers from "./gdpr.js";
import dotenv from "dotenv";

import { connectToMongoDB } from "./mongodb.js";

dotenv.config();

/* ------------------------------------------------ */
/*                    CONFIG                         */
/* ------------------------------------------------ */

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const PREMIUM_PLAN = PLAN_NAME;

const APP_NAMESPACE = "custom";
const SHOP_METAFIELD_KEY = "chatlink-whatsapp-button";
const APP_INSTALL_METAFIELD_KEY = "chatlink-whatsapp-button-premium";

const BILLING_TEST_OVERRIDE = process.env.SHOPIFY_BILLING_TEST;

const APP_NAME = "chatlink-whatsapp-button";

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
};

/* ------------------------------------------------ */
/*                EXPRESS APP INIT                   */
/* ------------------------------------------------ */

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ------------------------------------------------ */
/*             SHOPIFY AUTH & WEBHOOKS               */
/* ------------------------------------------------ */

app.get(shopify.config.auth.path, shopify.auth.begin());

app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);

app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: GDPRWebhookHandlers })
);

/* ------------------------------------------------ */
/*                   UTILITIES                       */
/* ------------------------------------------------ */

const getSession = (res) => res.locals.shopify.session;

const createGraphQLClient = (session) =>
  new shopify.api.clients.Graphql({ session });

const handleError = (res, code, message) => {
  console.error(message);
  res.status(code).send({ error: message });
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class BillingSyncPendingError extends Error {
  constructor(message = "Payment approved, but premium activation is still syncing.") {
    super(message);
    this.name = "BillingSyncPendingError";
  }
}

const resolveTierWithRetry = async (session, attempts = 5, delayMs = 1500) => {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const tier = await SubscriptionService.getPlanTier(session);
      if (tier === "premium") {
        return tier;
      }

      if (attempt < attempts - 1) {
        await wait(delayMs);
      }
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await wait(delayMs);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new BillingSyncPendingError();
};

const syncTierMetafields = async (session, tier) => {
  try {
    if (tier === "premium") {
      await MetafieldService.ensureAppMetafield(session);
    }
    await MetafieldService.updateShopMetafield(session, tier);
  } catch (error) {
    console.warn("Metafield update skipped:", error.message);
  }
};

const sendTierResponse = (res, tier) => {
  res.send({
    hasActiveSubscription: tier === "premium",
    tier,
  });
};

const isTruthyParam = (value) => value === "1" || value === "true";

const hasBillingReturn = (req) =>
  isTruthyParam(req.query?.billingReturn) || Boolean(req.query?.charge_id);

const getTierForStatusRequest = async (req, session) => {
  if (hasBillingReturn(req)) {
    return resolveTierWithRetry(session, 5, 1500);
  }

  return SubscriptionService.getPlanTier(session);
};

/* ------------------------------------------------ */
/*                BILLING SERVICE                    */
/* ------------------------------------------------ */

// Direct GraphQL helper — bypasses the library
async function shopifyGraphQL(session, query, variables = {}) {
  const res = await fetch(
    `https://${session.shop}/admin/api/2026-04/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`GraphQL ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const BillingService = {
  async check(session) {
    const { data } = await shopifyGraphQL(session, `{
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
        }
      }
    }`);
    const subs = data?.currentAppInstallation?.activeSubscriptions || [];
    return subs.some(
      (subscription) => subscription.name === PREMIUM_PLAN && subscription.status === "ACTIVE"
    );
  },

  async shouldUseTestBilling(session) {
    if (BILLING_TEST_OVERRIDE === "true") return true;
    if (BILLING_TEST_OVERRIDE === "false") return false;

    const { data } = await shopifyGraphQL(session, `{
      shop {
        plan {
          partnerDevelopment
          shopifyPlus
        }
      }
    }`);

    return Boolean(data?.shop?.plan?.partnerDevelopment);
  },

  async request(session) {
    const test = await this.shouldUseTestBilling(session);
    const { data } = await shopifyGraphQL(session, `
      mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!, $trialDays: Int) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems, trialDays: $trialDays) {
          appSubscription { id }
          confirmationUrl
          userErrors { field message }
        }
      }
    `, {
      name: PREMIUM_PLAN,
      returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`,
      test,
      trialDays: PLAN_TRIAL_DAYS > 0 ? PLAN_TRIAL_DAYS : null,
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: PLAN_AMOUNT, currencyCode: "USD" },
            interval: "EVERY_30_DAYS",
          },
        },
      }],
    });
    const result = data?.appSubscriptionCreate;
    if (result?.userErrors?.length) {
      throw new Error(result.userErrors.map(e => e.message).join(", "));
    }
    return result?.confirmationUrl;
  },

  async cancel(session) {
    const { data } = await shopifyGraphQL(session, `{
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
        }
      }
    }`);

    const activeSubscriptions = (data?.currentAppInstallation?.activeSubscriptions || []).filter(
      (subscription) => subscription.name === PREMIUM_PLAN && subscription.status === "ACTIVE"
    );

    if (!activeSubscriptions.length) {
      return "No subscription found";
    }

    for (const subscription of activeSubscriptions) {
      const cancellation = await shopifyGraphQL(session, `
        mutation appSubscriptionCancel($id: ID!) {
          appSubscriptionCancel(id: $id) {
            appSubscription {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        id: subscription.id,
      });

      const result = cancellation?.data?.appSubscriptionCancel;
      if (result?.userErrors?.length) {
        throw new Error(result.userErrors.map((error) => error.message).join(", "));
      }
    }

    return "CANCELLED";
  },
};

/* ------------------------------------------------ */
/*             SUBSCRIPTION SERVICE                  */
/* ------------------------------------------------ */

const SubscriptionService = {
  async getPlanTier(session) {
    try {
      const active = await BillingService.check(session);
      if (active) {
        return "premium";
      }

      const storedTier = await MetafieldService.getShopTier(session);
      return storedTier === "free" ? "free" : "free";
    } catch (err) {
      console.error("Subscription check failed:", err);
      return "free";
    }
  },
};

/* ------------------------------------------------ */
/*                METAFIELD SERVICE                  */
/* ------------------------------------------------ */

const MetafieldService = {
  async getShopGid(session) {
    const { data } = await shopifyGraphQL(session, `{ shop { id } }`);
    const shopId = data?.shop?.id;
    if (!shopId) throw new Error("Shop ID not found");
    return shopId;
  },

  async getShopTier(session) {
    const { data } = await shopifyGraphQL(session, SHOP_TIER_QUERY, {
      namespace: APP_NAMESPACE,
      key: SHOP_METAFIELD_KEY,
    });
    const value = data?.shop?.metafield?.value;
    return value === "premium" ? "premium" : value === "free" ? "free" : null;
  },

  async updateShopMetafield(session, tier) {
    const ownerId = await this.getShopGid(session);
    await shopifyGraphQL(session, CREATE_APP_DATA_METAFIELD, {
      metafieldsSetInput: [{
        ownerId,
        namespace: APP_NAMESPACE,
        key: SHOP_METAFIELD_KEY,
        type: "single_line_text_field",
        value: tier === "premium" ? "premium" : "free",
      }],
    });
  },

  async ensureAppMetafield(session) {
    const { data } = await shopifyGraphQL(session, CURRENT_APP_INSTALLATION, {
      namespace: APP_NAMESPACE,
      key: APP_INSTALL_METAFIELD_KEY,
    });
    const ownerId = data?.currentAppInstallation?.id;
    const existing = data?.currentAppInstallation?.metafield;
    if (!existing && ownerId) {
      await shopifyGraphQL(session, CREATE_APP_DATA_METAFIELD, {
        metafieldsSetInput: [{
          namespace: APP_NAMESPACE,
          key: APP_INSTALL_METAFIELD_KEY,
          type: "boolean",
          value: "true",
          ownerId,
        }],
      });
    }
  },

  async deleteAppMetafield(session) {
    const { data } = await shopifyGraphQL(session, CURRENT_APP_INSTALLATION, {
      namespace: APP_NAMESPACE,
      key: APP_INSTALL_METAFIELD_KEY,
    });
    const ownerId = data?.currentAppInstallation?.id;
    const existing = data?.currentAppInstallation?.metafield;
    if (ownerId && existing) {
      await shopifyGraphQL(session, APP_OWNED_METAFIELD_DELETE, {
        ownerId,
        namespace: APP_NAMESPACE,
        key: APP_INSTALL_METAFIELD_KEY,
      });
    }
  },
};

/* ------------------------------------------------ */
/*            PROTECTED ROUTES (AUTH)                */
/* ------------------------------------------------ */

app.use("/api", shopify.validateAuthenticatedSession());

/* ------------------------------------------------ */
/*           CREATE SUBSCRIPTION ROUTE               */
/* ------------------------------------------------ */

app.get("/api/createSubscription", async (req, res) => {
  try {
    const session = getSession(res);

    // Check if already subscribed
    let active = false;
    try {
      active = await BillingService.check(session);
    } catch (e) {
      console.warn("Billing check failed, assuming no subscription:", e.message);
    }

    if (active) {
      try { await MetafieldService.updateShopMetafield(session, "premium"); } catch (e) {}
      return res.send({ isActiveSubscription: true, plan: PREMIUM_PLAN });
    }

    // Request new subscription
    const confirmationUrl = await BillingService.request(session);
    console.log("Billing confirmation URL:", confirmationUrl);

    res.send({
      isActiveSubscription: false,
      plan: PREMIUM_PLAN,
      confirmationUrl,
    });
  } catch (err) {
    console.error("Create subscription error:", err.message);
    handleError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, err.message);
  }
});

/* ------------------------------------------------ */
/*             CANCEL SUBSCRIPTION ROUTE             */
/* ------------------------------------------------ */

app.get("/api/cancelSubscription", async (req, res) => {
  try {
    const session = getSession(res);

    const active = await BillingService.check(session);

    if (!active) {
      return res.send({ status: "No subscription found" });
    }

    const status = await BillingService.cancel(session);

    try {
      await MetafieldService.deleteAppMetafield(session);
      await MetafieldService.updateShopMetafield(session, "free");
    } catch (metafieldError) {
      console.warn("Metafield cleanup failed after cancel:", metafieldError.message);
    }

    res.send({
      status,
      cancelledPlan: PREMIUM_PLAN,
    });
  } catch (err) {
    handleError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, err.message);
  }
});

/* ------------------------------------------------ */
/*           CHECK ACTIVE SUBSCRIPTION               */
/* ------------------------------------------------ */

app.get("/api/hasActiveSubscription", async (req, res) => {
  try {
    const session = getSession(res);
    const tier = await getTierForStatusRequest(req, session);

    await syncTierMetafields(session, tier);
    sendTierResponse(res, tier);
  } catch (err) {
    if (err instanceof BillingSyncPendingError) {
      return res.status(HTTP_STATUS.CONFLICT).send({
        error: err.message,
        code: "BILLING_SYNC_PENDING",
      });
    }

    handleError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, err.message);
  }
});

/* ------------------------------------------------ */
/*                 SHOP INFO ROUTE                   */
/* ------------------------------------------------ */

app.get("/api/getshop", (req, res) => {
  const session = getSession(res);
  res.json({ shop: session?.shop || null });
});

app.get("/api/plan-info", (_req, res) => {
  res.json({
    name: PLAN_NAME,
    amount: PLAN_AMOUNT,
    trialDays: PLAN_TRIAL_DAYS,
    currency: "USD",
  });
});

// Debug: check what the token actually has
app.get("/api/debug-session", async (req, res) => {
  const session = getSession(res);
  const token = session?.accessToken || "none";
  const maskedToken = token.length > 8 ? token.slice(0, 4) + "..." + token.slice(-4) : token;

  // Try a direct fetch to Shopify GraphQL
  let apiResult = "not tested";
  try {
    const response = await fetch(
      `https://${session.shop}/admin/api/2026-04/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify({ query: "{ shop { name } }" }),
      }
    );
    apiResult = { status: response.status, body: await response.text() };
  } catch (e) {
    apiResult = { error: e.message };
  }

  res.json({
    shop: session?.shop,
    scope: session?.scope,
    token: maskedToken,
    isOnline: session?.isOnline,
    apiResult,
  });
});

/* ------------------------------------------------ */
/*              FRONTEND SERVING                     */
/* ------------------------------------------------ */

app.use(shopify.cspHeaders());

app.use(serveStatic(STATIC_PATH, { index: false }));

// Serve the React app for every non-API path. Token-exchange auth happens
// inside the iframe via App Bridge — the backend should not redirect uninstalled
// shops to the legacy /api/auth flow (which returns 410 Gone in shopify-app-express v7+).
app.use("/", async (_req, res) => {
  res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

/* ------------------------------------------------ */
/*                   GRAPHQL                         */
/* ------------------------------------------------ */

const CURRENT_APP_INSTALLATION = `
query appSubscription($namespace: String!, $key: String!) {
  currentAppInstallation {
    id
    metafield(namespace: $namespace, key: $key) {
      namespace
      key
      value
      id
    }
  }
}
`;

const SHOP_TIER_QUERY = `
query shopTier($namespace: String!, $key: String!) {
  shop {
    metafield(namespace: $namespace, key: $key) {
      value
    }
  }
}
`;

const CREATE_APP_DATA_METAFIELD = `
mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafieldsSetInput) {
    metafields { id namespace key }
    userErrors { field message }
  }
}
`;

const APP_OWNED_METAFIELD_DELETE = `
mutation appOwnedMetafieldDelete($ownerId: ID!, $namespace: String!, $key: String!) {
  appOwnedMetafieldDelete(ownerId: $ownerId, namespace: $namespace, key: $key) {
    deletedId
    userErrors { field message }
  }
}
`;