// Site settings — edit these, no code changes needed.
window.JIMAT_CONFIG = {
  siteName: "JimatBasket",

  // "Support us" modal. Remove any entry you don't use.
  support: {
    message:
      "JimatBasket is free and ad-light. If it saved you a few ringgit, a small tip keeps the servers running and the prices fresh.",
    links: [
      { label: "Buy me a teh tarik (Ko-fi)", url: "https://ko-fi.com/YOUR_NAME", icon: "☕" },
      { label: "GitHub Sponsors", url: "https://github.com/sponsors/YOUR_NAME", icon: "💚" },
    ],
    // Path to your DuitNow / Touch 'n Go QR image, or null to hide
    duitNowQr: null,
  },

  // Ad slots. While `adsense.client` is empty, tasteful house ads are shown
  // instead. To use Google AdSense, fill in your client and slot IDs.
  ads: {
    adsense: { client: "", slots: { top: "", inline: "" } },
    house: [
      {
        title: "Advertise on JimatBasket",
        text: "Reach thousands of Malaysian shoppers comparing prices every day.",
        cta: "Get in touch",
        url: "mailto:hello@example.com?subject=Advertising%20on%20JimatBasket",
      },
      {
        title: "Run a kedai runcit?",
        text: "List your store's prices for free and get found by nearby shoppers.",
        cta: "List my store",
        url: "mailto:hello@example.com?subject=List%20my%20store",
      },
    ],
  },
};
