"""
YouTube Comment Extractor
--------------------------
Pulls every comment (+ replies) from every video on a given YouTube channel
and exports to CSV.

SETUP
1. pip install google-api-python-client
2. Get a YouTube Data API v3 key from Google Cloud Console:
   https://console.cloud.google.com/apis/credentials
   (Enable "YouTube Data API v3" on your project first.)
3. Paste your key into API_KEY below, or pass it via --api_key

USAGE
    python youtube_comment_extractor.py --channel @IndianFarmerOfficial
    python youtube_comment_extractor.py --channel UCxxxxxxxxxxxxxxxxxx
    python youtube_comment_extractor.py --channel @SomeOtherChannel --output other_channel.csv

Works on ANY public channel, not just your own — same API, same quota cost.
"""

import argparse
import csv
import sys
import time

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

API_KEY = "PASTE_YOUR_API_KEY_HERE"  # <-- put your key here, or use --api_key


def get_channel_id(youtube, channel_input):
    """Resolve a @handle or channel ID or channel URL to a channel ID."""
    channel_input = channel_input.strip()

    if channel_input.startswith("UC") and len(channel_input) == 24:
        return channel_input

    handle = channel_input.lstrip("@")
    try:
        resp = youtube.channels().list(part="id", forHandle=handle).execute()
        items = resp.get("items", [])
        if items:
            return items[0]["id"]
    except HttpError:
        pass

    resp = youtube.search().list(
        part="snippet", q=channel_input, type="channel", maxResults=1
    ).execute()
    items = resp.get("items", [])
    if not items:
        raise ValueError(f"Could not resolve channel: {channel_input}")
    return items[0]["snippet"]["channelId"]


def get_uploads_playlist_id(youtube, channel_id):
    resp = youtube.channels().list(part="contentDetails", id=channel_id).execute()
    return resp["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]


def get_all_video_ids(youtube, playlist_id):
    video_ids = []
    video_titles = {}
    next_page_token = None

    while True:
        resp = youtube.playlistItems().list(
            part="snippet",
            playlistId=playlist_id,
            maxResults=50,
            pageToken=next_page_token,
        ).execute()

        for item in resp.get("items", []):
            vid = item["snippet"]["resourceId"]["videoId"]
            video_ids.append(vid)
            video_titles[vid] = item["snippet"]["title"]

        next_page_token = resp.get("nextPageToken")
        if not next_page_token:
            break

    return video_ids, video_titles


def get_comments_for_video(youtube, video_id, video_title, writer):
    next_page_token = None
    count = 0

    while True:
        try:
            resp = youtube.commentThreads().list(
                part="snippet,replies",
                videoId=video_id,
                maxResults=100,
                order="time",
                pageToken=next_page_token,
                textFormat="plainText",
            ).execute()
        except HttpError as e:
            reason = str(e)
            if "commentsDisabled" in reason or "disabled comments" in reason.lower():
                print(f"  [skip] Comments disabled: {video_title}")
            else:
                print(f"  [error] {video_title}: {e}")
            return 0

        for item in resp.get("items", []):
            top = item["snippet"]["topLevelComment"]["snippet"]
            top_id = item["snippet"]["topLevelComment"]["id"]
            writer.writerow({
                "video_id": video_id,
                "video_title": video_title,
                "comment_id": top_id,
                "parent_comment_id": "",
                "author": top.get("authorDisplayName", ""),
                "comment_text": top.get("textDisplay", "").replace("\n", " "),
                "published_date": top.get("publishedAt", ""),
                "like_count": top.get("likeCount", 0),
                "reply_count": item["snippet"].get("totalReplyCount", 0),
            })
            count += 1

            for reply in item.get("replies", {}).get("comments", []):
                rs = reply["snippet"]
                writer.writerow({
                    "video_id": video_id,
                    "video_title": video_title,
                    "comment_id": reply["id"],
                    "parent_comment_id": top_id,
                    "author": rs.get("authorDisplayName", ""),
                    "comment_text": rs.get("textDisplay", "").replace("\n", " "),
                    "published_date": rs.get("publishedAt", ""),
                    "like_count": rs.get("likeCount", 0),
                    "reply_count": 0,
                })
                count += 1

        next_page_token = resp.get("nextPageToken")
        if not next_page_token:
            break

    return count


def main():
    parser = argparse.ArgumentParser(description="Extract all comments from a YouTube channel's videos.")
    parser.add_argument("--channel", required=True, help="Channel @handle, channel ID (UC...), or name")
    parser.add_argument("--api_key", default=API_KEY, help="YouTube Data API v3 key")
    parser.add_argument("--output", default="youtube_comments.csv", help="Output CSV filename")
    args = parser.parse_args()

    if not args.api_key or args.api_key == "PASTE_YOUR_API_KEY_HERE":
        print("ERROR: No API key provided. Set API_KEY in the script or pass --api_key YOUR_KEY")
        sys.exit(1)

    youtube = build("youtube", "v3", developerKey=args.api_key)

    print(f"Resolving channel: {args.channel}")
    channel_id = get_channel_id(youtube, args.channel)
    print(f"Channel ID: {channel_id}")

    playlist_id = get_uploads_playlist_id(youtube, channel_id)
    print("Fetching video list...")
    video_ids, video_titles = get_all_video_ids(youtube, playlist_id)
    print(f"Found {len(video_ids)} videos")

    fieldnames = [
        "video_id", "video_title", "comment_id", "parent_comment_id",
        "author", "comment_text", "published_date", "like_count", "reply_count",
    ]

    total_comments = 0
    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for i, vid in enumerate(video_ids, 1):
            title = video_titles.get(vid, vid)
            print(f"[{i}/{len(video_ids)}] {title}")
            n = get_comments_for_video(youtube, vid, title, writer)
            total_comments += n
            time.sleep(0.1)  # be gentle on quota/rate

    print(f"\nDone. {total_comments} comments from {len(video_ids)} videos written to {args.output}")


if __name__ == "__main__":
    main()
