import localFont from "next/font/local";

export const ratch = localFont({
  src: [
    { path: "./Ratch-Thin.otf", weight: "100", style: "normal" },
    { path: "./Ratch-Light.otf", weight: "300", style: "normal" },
    { path: "./Ratch-Regular.otf", weight: "400", style: "normal" },
    { path: "./Ratch-Medium.otf", weight: "500", style: "normal" },
    { path: "./Ratch-Bold.otf", weight: "700", style: "normal" },
    { path: "./Ratch-ExtraBold.otf", weight: "800", style: "normal" },
  ],
  variable: "--font-ratch",
  display: "swap",
});
