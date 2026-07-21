import { useEffect, useState } from "react";
import { PriceChecker } from "../services/PriceEstimator";
import { Price } from "../services/types";

type UpscaledPriceSnapshot = {
  key: string;
  prices: Price[];
};

export function useUpscaledPrices(prices: Price[], league?: string) {
  const key = JSON.stringify(prices);
  const [snapshot, setSnapshot] = useState<UpscaledPriceSnapshot>();

  useEffect(() => {
    if (key === "[]") {
      setSnapshot(undefined);
      return;
    }

    const controller = new AbortController();
    const sourcePrices = JSON.parse(key) as Price[];

    void PriceChecker.upscalePrices(sourcePrices, league, {
      signal: controller.signal,
    })
      .then((upscaledPrices) => {
        if (!controller.signal.aborted) {
          setSnapshot({ key, prices: upscaledPrices });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn("Unable to format derived prices", error);
        }
      });

    return () => controller.abort();
  }, [key, league]);

  return snapshot?.key === key ? snapshot.prices : prices;
}
