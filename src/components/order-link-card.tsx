"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Copy, Printer, QrCode } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function OrderLinkCard({ companyName }: { companyName: string }) {
  // Build from the live origin the user is actually on — always the right domain.
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");

  useEffect(() => {
    const u = `${window.location.origin}/order`;
    setUrl(u);
    QRCode.toDataURL(u, { width: 320, margin: 1 })
      .then(setQr)
      .catch(() => {});
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Order link copied");
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  };

  const printSign = () => {
    const w = window.open("", "_blank", "width=640,height=840");
    if (!w) {
      toast.error("Allow pop-ups to print the sign.");
      return;
    }
    w.document.write(
      `<!doctype html><html><head><title>Place an order</title><meta charset="utf-8"/>
       <style>
         body{font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:48px 24px;color:#111}
         h1{font-size:34px;margin:0 0 6px}
         .sub{font-size:18px;color:#555;margin:0 0 28px}
         img{width:340px;height:340px}
         .url{font-size:15px;color:#333;margin-top:16px;word-break:break-all}
         .foot{margin-top:24px;font-size:14px;color:#777}
       </style></head>
       <body>
         <h1>${companyName}</h1>
         <p class="sub">Scan to place a carpet order for pickup</p>
         <img src="${qr}" alt="Order QR"/>
         <div class="url">${url}</div>
         <div class="foot">No login needed — pick or describe what you need, we'll cut it and text you when it's ready.</div>
         <script>window.onload=function(){window.print()}</script>
       </body></html>`,
    );
    w.document.close();
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <QrCode className="size-4" /> Your order link
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-2">
          <p className="text-sm text-muted-foreground">
            Share this with your installers &amp; trade customers to submit
            orders — no login needed.
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={printSign}
            disabled={!qr}
          >
            <Printer className="size-3.5" /> Print counter sign
          </Button>
        </div>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="Order link QR code"
            className="mx-auto size-32 rounded-lg border bg-white p-1"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
