# Daraz Price Checker

A simple local web app for checking Daraz.lk prices.

You search for products or paste a Daraz product link, add items to a list, and click **Check final prices**. The app shows:

- the price shown on the product page
- the price found at Daraz checkout for each selected product
- delivery fees, platform fees, service fees, taxes, vouchers, and discounts when Daraz shows them
- the checkout total when Daraz shows it

## Run The App

```bash
cd /Users/rk_vishva/Documents/Projects/CartTruth
pnpm install
pnpm web
```

Open:

```text
http://localhost:5173
```

## Daraz Login

Daraz checkout prices need the app's inbuilt browser login. Logging in through your everyday browser does not share the session with the checker.

In the app:

1. Click **Open Inbuilt Daraz Login**.
2. Sign in to Daraz in the inbuilt browser window.
3. Return to the app and click **Save Login**.
4. Add products and click **Check final prices**.

You can also paste a product URL such as:

```text
https://www.daraz.lk/products/singer-crt-tv-remote-controller-i106694729-s1014616565.html
```

The saved app login profile is stored locally at:

```text
.carttruth/sessions/daraz/default-profile/
```

## Useful Commands

```bash
pnpm web
pnpm api
pnpm verify
```

`pnpm api` starts only the local API server at `http://localhost:4174`.

## Safety

The checker is designed to stop before purchase. It must not submit orders, pay, confirm purchases, or save payment details.
