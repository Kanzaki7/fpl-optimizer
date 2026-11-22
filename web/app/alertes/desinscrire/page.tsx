import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertAction } from "@/components/AlertAction";

export const metadata: Metadata = { title: "Alertes e-mail", robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <AlertAction kind="desinscrire" />
    </Suspense>
  );
}
