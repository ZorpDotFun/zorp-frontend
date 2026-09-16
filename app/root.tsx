import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { AppPrivyProvider } from "./components/app-privy-provider";
import { Footer } from "./components/footer";
import { Navbar } from "./components/navbar";
import { PrivyDevOrigin } from "./components/privy-dev-origin";
import { VercelAnalytics } from "./components/vercel-analytics";
import { ThemeProvider, themeBootScript } from "./lib/theme";
import "./app.css";

export const links: Route.LinksFunction = () => [
  {
    rel: "preload",
    href: "/assets/fonts/audiowide/Audiowide-Regular.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
  {
    rel: "preload",
    href: "/assets/fonts/satoshi/Satoshi-Regular.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/assets/logos/logomark-10x.png" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <PrivyDevOrigin />
        {children}
        <ScrollRestoration />
        <Scripts />
        <VercelAnalytics />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppPrivyProvider>
        <div className="flex min-h-dvh flex-col">
          <Navbar />
          <div className="flex-1">
            <Outlet />
          </div>
          <Footer />
        </div>
      </AppPrivyProvider>
    </ThemeProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
