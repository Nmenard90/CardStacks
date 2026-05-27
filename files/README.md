# Pokémon Card Tracker

## Local setup (one time)

1. Install Node.js from https://nodejs.org (LTS version)
2. Open a terminal in this folder
3. Run: `npm install`

## Run it locally

```
npm start
```

Open http://localhost:3000 in your browser.

## Deploy to Railway (share with others)

1. Push this folder to a GitHub repo
2. Go to https://railway.app and sign up free
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repo — Railway auto-detects Node and deploys it
5. Click the generated URL and share it with anyone

## Notes

- Each user gets their own collection saved in the `data/` folder
- Card data is cached in `cache.json` for 24 hours (fast after first load)
- Press Ctrl+C in terminal to stop the local server
