// @ts-check
import React, { useState, useCallback } from "react";
import {
  Card,
  Page,
  Layout,
  Button,
  Modal,
  Frame,
  TopBar,
  Stack,
} from "@shopify/polaris";
import { useNavigate } from "react-router-dom";

export default function Installation() {
  const [active, setActive] = useState(false);
  const handleChange = useCallback(() => setActive(!active), [active]);
  const navigate = useNavigate();

  const sectionStyle = {
    background: "#fff",
    borderRadius: 16,
    padding: 28,
    boxShadow: "0 4px 24px rgba(99, 102, 241, 0.08)",
    border: "1px solid #E0E7FF",
    marginBottom: 20,
  };

  const accentBar = (
    <div
      style={{
        height: 4,
        width: 64,
        borderRadius: 999,
        background: "linear-gradient(90deg, #0084FF 0%, #00D4FF 50%, #A78BFA 100%)",
        marginBottom: 14,
      }}
    />
  );

  const stepNumberStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#0084FF",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    marginRight: 14,
    flexShrink: 0,
  };

  const stepCardStyle = {
    background: "#F5F3FF",
    borderRadius: 12,
    padding: "18px 22px",
    border: "1px solid #E0E7FF",
    marginBottom: 12,
    display: "flex",
    alignItems: "flex-start",
  };

  return (
    <Frame topBar={<TopBar />}>
      <Page>
        <Layout>

          {/* Header */}
          <Layout.Section>
            <div style={{
              background: "linear-gradient(135deg, #0084FF 0%, #00D4FF 100%)",
              borderRadius: 20,
              padding: "32px 28px",
              color: "#fff",
              marginBottom: 4,
            }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.5px" }}>
                Installation Guide
              </h1>
              <p style={{ margin: 0, fontSize: 15, opacity: 0.9 }}>
                Get ChatLink running on your store in under 2 minutes.
              </p>
            </div>
          </Layout.Section>

          {/* Theme Editor Setup */}
          <Layout.Section>
            <div style={sectionStyle}>
              {accentBar}
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#002B5C", marginBottom: 20 }}>
                Theme Editor Setup
              </h2>

              {[
                {
                  title: "Open Theme Editor",
                  desc: "Go to your Shopify admin \u2192 Online Store \u2192 Themes \u2192 Customize. Or click the button on the dashboard.",
                },
                {
                  title: "Add the ChatLink Block",
                  desc: "In the theme editor, click Add block \u2192 Apps \u2192 ChatLink WhatsApp Button.",
                },
                {
                  title: "Configure Your Number",
                  desc: "Enter your WhatsApp phone number with country code (e.g. 911234567890). Optionally set a default message.",
                },
                {
                  title: "Customize Appearance",
                  desc: "Choose icon style (Official, Bubble, or Minimal), set color, shape (circle/rounded/square), and position.",
                },
                {
                  title: "Save & Publish",
                  desc: "Click Save in the theme editor. Your WhatsApp button is now live on your store!",
                },
              ].map((step, i) => (
                <div key={i} style={stepCardStyle}>
                  <span style={stepNumberStyle}>{i + 1}</span>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "#4338CA", margin: "0 0 4px" }}>
                      {step.title}
                    </h3>
                    <p style={{ fontSize: 14, color: "#6B7280", margin: 0, lineHeight: 1.6 }}>
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Layout.Section>

          {/* Premium Features */}
          <Layout.Section>
            <div style={sectionStyle}>
              {accentBar}
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#002B5C", marginBottom: 14 }}>
                Premium Page Visibility
              </h2>
              <p style={{ color: "#6B7280", fontSize: 14, marginBottom: 16, lineHeight: 1.6 }}>
                With the Premium plan, you can control which pages show the WhatsApp button:
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {["All Pages", "Homepage", "Product Pages", "Collection Pages"].map((page) => (
                  <span key={page} style={{
                    background: "#EEF2FF",
                    color: "#4338CA",
                    fontWeight: 600,
                    fontSize: 13,
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: "1px solid #C7D2FE",
                  }}>
                    {page}
                  </span>
                ))}
              </div>

              <div style={{ marginTop: 20 }}>
                <Button onClick={() => navigate("/pricing")}>
                  View Plans
                </Button>
              </div>
            </div>
          </Layout.Section>

          {/* Video Modal */}
          <Modal
            open={active}
            onClose={handleChange}
            title="Quick Setup Guide"
          >
            <Modal.Section>
              <div style={{ padding: "56% 0 0 0", position: "relative" }}>
                <iframe
                  src="https://cdn.shopify.com/videos/c/o/v/879c7b0f313e4e858abc5c16733670d3.mp4?portrait=0&loop=1&title=0&byline=0&sidedock=0&h=881b23983c&badge=0&autopause=0&player_id=0&app_id=58479&autoplay=1"
                  frameBorder="0"
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                  }}
                  title="Quick Setup"
                />
              </div>
            </Modal.Section>
          </Modal>

        </Layout>
      </Page>
    </Frame>
  );
}
