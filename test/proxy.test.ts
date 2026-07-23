import axios from "axios";
import { expect, test } from "bun:test";

const liveTest = process.env.POE_DASH_LIVE_TESTS ? test : test.skip;

liveTest("forwards requests through a running local proxy", async () => {
  const url =
    "www.pathofexile.com/api/trade2/fetch/25832d90f5375a3afdccdf892ede7649bdfdc37ea9fe7c6047e6839ea602aa12?query=RnXVJ2ac7&realm=poe2";

  const port = process.env.PORT || 7555;
  const response = await axios.get(`http://localhost:${port}/proxy/${url}`);
  expect(response.status).toBe(200);
});
