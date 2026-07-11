# Daraz Price Checker Notes

The app is intentionally small:

- Search Daraz products.
- Add products to the selected list.
- Save one Daraz login session.
- Check product-page price and Buy Now checkout price for one unit of each selected product.

The normal web UI should not expose developer concepts such as proxy settings, scenarios, expected totals, or tolerances.

Checkout can still require manual attention if Daraz shows CAPTCHA, OTP, unavailable items, required product options, payment prompts, or address prompts. In those cases the app stops and shows a plain status message.

The default flow uses product-page Buy Now and checkout extraction. It does not add products to the Daraz cart or isolate selected cart rows. Multiple selected products are checked sequentially, with each product receiving its own checkout breakdown.
