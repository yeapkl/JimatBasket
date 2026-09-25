// Site settings — edit these, no code changes needed.
window.JIMAT_CONFIG = {
  siteName: "JimatBasket",
  defaultLang: "en", // "en" | "ms" | "zh"

  // "Support us" modal. Remove any entry you don't use.
  support: {
    message: {
      en: "JimatBasket is free and ad-light. If it saved you a few ringgit, a small tip keeps the servers running and the prices fresh.",
      ms: "JimatBasket percuma dan kurang iklan. Jika ia menjimatkan beberapa ringgit, sumbangan kecil membantu kami terus beroperasi.",
      zh: "JimatBasket 免费且广告很少。如果它帮你省了几块钱，一点小小的支持能让网站持续运作。",
    },
    links: [
      { label: "Buy me a teh tarik (Ko-fi)", url: "https://ko-fi.com/YOUR_NAME", icon: "☕" },
      { label: "GitHub Sponsors", url: "https://github.com/sponsors/YOUR_NAME", icon: "💚" },
    ],
    // Path to your DuitNow / Touch 'n Go QR image, or null to hide
    duitNowQr: null,
  },

  // "Report a price" form. Set `endpoint` to a form backend that accepts
  // multipart POSTs (e.g. https://formspree.io/f/XXXX or a Google Apps Script
  // web app URL) to receive submissions with photos. While empty, the form
  // opens the visitor's email app addressed to `email` instead.
  submit: {
    endpoint: "",
    email: "hello@example.com",
  },

  // "Buy online" buttons on each product. Put your affiliate links here.
  // `{q}` is replaced with the product name (URL-encoded) if present.
  shopOnline: [
    { name: "GrabMart", url: "https://food.grab.com/my/en/" },
    { name: "foodpanda pandamart", url: "https://www.foodpanda.my/" },
    { name: "Lotus's Online", url: "https://www.lotuss.com.my/" },
    { name: "myAEON2go", url: "https://myaeon2go.com/" },
  ],

  // Sponsored "Featured deal" cards shown first in the results. Sell these
  // slots to stores/brands. Leave the list empty to hide.
  featured: [
    {
      badge: "Featured",
      title: "Your deal could be here",
      text: "Promote a weekly special to shoppers who are ready to buy.",
      cta: "Feature my deal",
      url: "mailto:hello@example.com?subject=Featured%20deal%20on%20JimatBasket",
    },
  ],

  // Ad slots. While `adsense.client` is empty, house ads are shown instead.
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
