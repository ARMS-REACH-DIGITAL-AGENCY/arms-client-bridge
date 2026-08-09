export const metadata = {
  title: "ARMS Client Bridge",
  description: "Internal ARMS client integration bridge",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif", background: "#f7f7f7", color: "#222" }}>
        {children}
      </body>
    </html>
  );
}
