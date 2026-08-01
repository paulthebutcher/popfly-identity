// Minimal root layout — this app is route handlers only, but Next.js
// requires a root layout to build the auto-generated not-found page.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
