import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Moore Made | Custom Goods, Made for You",
  description: "Custom apparel, gifts, business printing, drinkware, bags, paper goods and more from Moore Made LLC."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        {process.env.MOORE_MADE_PREVIEW === "1" ? (
          <div role="note" style={{ background: "#173b57", color: "#fff", padding: "12px 20px", textAlign: "center", fontSize: "14px", lineHeight: 1.5 }}>
            Moore Made test workspace · Live orders, payments and emails are disconnected.
          </div>
        ) : null}
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
