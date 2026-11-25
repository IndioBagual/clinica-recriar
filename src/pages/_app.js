import Script from 'next/script';
import { Lora, Plus_Jakarta_Sans } from 'next/font/google';
import '../styles/globals.css';

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-6GT8FRV5GG';

export default function App({ Component, pageProps }) {
  return (
    <div className={`${plusJakarta.variable} ${lora.variable} font-sans`}>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', { anonymize_ip: true });
        `}
      </Script>
      <Component {...pageProps} />
    </div>
  );
}