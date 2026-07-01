# Daraz Price Checker Notes

The app is intentionally small:

- Search Daraz products.
- Add products to the selected list.
- Save one Daraz login session.
- Check product-page price and checkout price.

The normal web UI should not expose developer concepts such as proxy settings, scenarios, expected totals, or tolerances.

Checkout can still require manual attention if Daraz shows CAPTCHA, OTP, unavailable items, payment prompts, or address prompts. In those cases the app stops and shows a plain status message.
