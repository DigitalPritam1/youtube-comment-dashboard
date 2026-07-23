# YouTube Comment Dashboard

A client-side dashboard for extracting and exploring comments (and replies) from a
YouTube channel using the YouTube Data API v3.

**Live site:** https://digitalpritam1.github.io/youtube-comment-dashboard/

## Contents

- `index.html` — the browser dashboard. Runs entirely in your browser; you paste
  your own YouTube Data API v3 key (nothing is stored server-side).
- `youtube_comment_extractor.py` — an optional command-line version that exports
  every comment from a channel to CSV.

## Using the dashboard

1. Open the live site.
2. Get a YouTube Data API v3 key from the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   (enable "YouTube Data API v3" on your project first).
3. Paste the key and a channel handle (e.g. `@IndianFarmerOfficial`) and run.

Your API key stays in your browser and is only sent to Google's YouTube API.

## Using the Python extractor

```bash
pip install google-api-python-client
python youtube_comment_extractor.py --channel @IndianFarmerOfficial --api_key YOUR_KEY
```
