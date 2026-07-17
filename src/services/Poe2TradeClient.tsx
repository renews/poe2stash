import axios from "axios";
import {
  Poe2ExchangeSearch,
  Poe2CurrencyExchangeOverview,
  Poe2TradeSearch,
  Poe2FetchItems,
  Poe2ItemSearch,
} from "./types";

export function getCurrencyRateFromOverview(
  overview: Poe2CurrencyExchangeOverview,
  iWant: string,
  iHave: string,
): number | undefined {
  if (iWant === iHave) {
    return 1;
  }

  const primary = overview.core?.primary || "divine";
  const primaryValues = new Map(
    (overview.lines || []).map((line) => [line.id, line.primaryValue]),
  );

  const getPrimaryValue = (currency: string) => {
    if (currency === primary) {
      return 1;
    }

    const lineValue = primaryValues.get(currency);
    if (typeof lineValue === "number" && Number.isFinite(lineValue) && lineValue > 0) {
      return lineValue;
    }

    const rate = overview.core?.rates?.[currency];
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0
      ? 1 / rate
      : undefined;
  };

  const wantValue = getPrimaryValue(iWant);
  const haveValue = getPrimaryValue(iHave);

  if (!wantValue || !haveValue) {
    return undefined;
  }

  return haveValue / wantValue;
}

export class Poe2TradeClient {
  port = 7555;
  baseUrl = `http://localhost:${this.port}`;
  tradeUrl = "www.pathofexile.com/api/trade2";
  apiUrl = `${this.baseUrl}/proxy/${this.tradeUrl}`;
  economyUrl = "poe.ninja/poe2/api/economy/exchange/current/overview";
  economyApiUrl = `${this.baseUrl}/proxy/${this.economyUrl}`;
  league = "Standard";

  async getAccountItems(account: string, price = 1, currency = "exalted", league?: string) {
    const url = `${this.apiUrl}/search/poe2/${league || this.league}`;
    console.log("Requesting", url, "account", account, "price", price);
    const response = await axios.post(url, {
      query: {
        filters: {
          trade_filters: {
            filters: {
              account: { input: account },
              price: {
                min: price,
                option: currency === "exalted" ? undefined : currency,
              },
            },
          },
        },
      },
      sort: { price: "asc" },
    });
    return response.data as Poe2TradeSearch;
  }

  range(min?: number | undefined, max?: number | undefined) {
    const params = {
      ...(min && { min: min }),
      ...(max && { max: max }),
    };

    return min || max ? params : undefined;
  }

  async getItemByAttributes(searchParams: Poe2ItemSearch, league?: string) {
    const url = `${this.apiUrl}/search/poe2/${league || this.league}`;
    console.log("Requesting", url, "searchParams", searchParams);

    const payload = {
      query: {
        name: searchParams.name,
        type: searchParams.baseType,
        status: { option: searchParams.status || "any" },
        stats: [
          {
            type: "and",
            filters: [
              ...(searchParams?.explicit || []),
              ...(searchParams?.implicit || []),
            ].map((mod) => ({
              id: mod.id,
              ...(mod.min !== undefined || mod.max !== undefined
                ? { value: { min: mod.min, max: mod.max } }
                : {}),
            })),
          },
        ],
        filters: {
          type_filters: {
            filters: {
              category: searchParams.category
                ? { option: searchParams.category }
                : undefined,

              rarity: searchParams.rarity
                ? { option: searchParams.rarity }
                : undefined,

              ilvl: this.range(searchParams.ilvl),
              quality: this.range(searchParams.quality),
            },
          },
          equipment_filters: {
            filters: {
              ar: this.range(searchParams.ar),
              es: this.range(searchParams.es),
              ev: this.range(searchParams.ev),
              damage: this.range(searchParams.damage),
              crit: this.range(searchParams.crit),
              pdps: this.range(searchParams.pdps),
              edps: this.range(searchParams.edps),
              dps: this.range(searchParams.dps),
              aps: this.range(searchParams.aps),
              block: this.range(searchParams.block),
              rune_sockets: this.range(searchParams.rune_sockets),
              spirit: this.range(searchParams.spirit),
            },
          },
          req_filters: {
            filters: {
              lvl: this.range(searchParams.lvl),
              dex: this.range(searchParams.dex),
              str: this.range(searchParams.str),
              int: this.range(searchParams.int),
            },
          },
          map_filters: {
            filters: { map_tier: this.range(searchParams.map_tier) },
          },
          misc_filters: {
            filters: {
              gem_level: this.range(searchParams.gem_level),
              gem_sockets: this.range(searchParams.gem_sockets),
              area_level: this.range(searchParams.area_level),
              stack_size: this.range(searchParams.stack_size),
              corrupted: searchParams.corrupted,
            },
          },

          trade_filters: {
            filters: {
              price: {
                min: searchParams.price || 1,
                option:
                  searchParams.currency === "exalted"
                    ? undefined
                    : searchParams.currency,
              },
            },
          },
        },
      },

      sort: { [searchParams.sort || "price"]: searchParams.direction || "asc" },
    };

    for (const key in payload.query.filters) {
      const typedKey = key as keyof typeof payload.query.filters;
      const filter = payload.query.filters[typedKey];

      const noKeys = Object.keys(filter.filters).length === 0;
      const noValues =
        Object.values(filter.filters).filter((v) => v !== undefined).length ===
        0;

      if (noKeys || noValues) {
        delete payload.query.filters[typedKey];
      }
    }

    const response = await axios.post(url, payload);
    return response.data as Poe2TradeSearch;
  }

  async getAccountItemsByItemLevel(
    account: string,
    price = 1,
    currency = "exalted",
    minItemLevel?: number,
    maxItemLevel?: number,
    league?: string
  ) {
    const url = `${this.apiUrl}/search/poe2/${league || this.league}`;
    console.log("Requesting", url, "account", account, "price", price);
    const response = await axios.post(url, {
      query: {
        filters: {
          trade_filters: {
            filters: {
              account: { input: account },
              price: {
                min: price,
                max: price,
                option: currency === "exalted" ? undefined : currency,
              },
            },
          },
          type_filters: {
            filters: {
              ilvl: {
                ...(minItemLevel && { min: minItemLevel }),
                ...(maxItemLevel && { max: maxItemLevel }),
              },
            },
          },
        },
      },
      sort: { ilvl: "asc" },
    });
    return response.data as Poe2TradeSearch;
  }

  async fetchItems(items: string[]) {
    if (!items.length) {
      return { result: [] } as Poe2FetchItems;
    }
    const response = await axios.get(
      `${this.apiUrl}/fetch/${items.slice(0, 10).join(",")}?&realm=poe2`,
    );
    return response.data as Poe2FetchItems;
  }

  async getCurrencySwaps(iWant: string, iHave: string, league?: string) {
    const url = `${this.apiUrl}/exchange/poe2/${league || this.league}`;
    const payload = {
      query: {
        status: { option: "online" },
        have: [iHave],
        want: [iWant],
      },
      sort: { have: "asc" },
      engine: "new",
    };
    console.log("Requesting", url, "iWant", iWant, "iHave", iHave);
    const response = await axios.post(url, payload);
    return response.data as Poe2ExchangeSearch;
  }

  async getCurrencyExchangeOverview(league?: string) {
    const params = new URLSearchParams({
      league: league || this.league,
      type: "Currency",
    });
    const url = `${this.economyApiUrl}?${params.toString()}`;
    console.log("Requesting currency overview", url);
    const response = await axios.get(url);
    return response.data as Poe2CurrencyExchangeOverview;
  }
}

export const Poe2Client = new Poe2TradeClient();
