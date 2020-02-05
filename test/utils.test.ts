import { abstractCookies } from "../src/utils";

describe("cookie utils", () => {
  it("should parse a multicookie string into an abstraction", () => {
    const cookies = abstractCookies(
      "__cfduid=d59f290664b58f3ddc256c03cb943d9d31580935359; expires=Fri, 06-Mar-20 20:42:39 GMT; path=/; domain=.homesick.com; HttpOnly; SameSite=Lax\ncart_currency=USD; path=/; expires=Wed, 19 Feb 2020 20:42:39 GMT\ncart_sig=; path=/; expires=Wed, 19 Feb 2020 20:42:39 GMT; HttpOnly\n_shopify_country=Canada; path=/\n_orig_referrer=; Expires=Wed, 19-Feb-20 20:42:39 GMT; Path=/; HttpOnly\n_shopify_y=d2a4f91d-bedb-441c-ad7b-e13fd1c0659e; path=/; expires=Sat, 05 Feb 2022 08:21:03 GMT\nsecure_customer_sig=; path=/; expires=Sun, 05 Feb 2040 20:42:39 GMT; secure; HttpOnly\n_landing_page=%2F; Expires=Wed, 19-Feb-20 20:42:39 GMT; Path=/; HttpOnly"
    );

    console.log(cookies);
    expect(cookies.length).toEqual(8);
  });
});
