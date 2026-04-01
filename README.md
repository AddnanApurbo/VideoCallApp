# Simple WebRTC 1-to-1 Demo

This project is a beginner-friendly WebRTC video call demo with:

- an Express server
- a WebSocket signaling server
- a tiny browser client in `public/`

It is prepared for easy deployment to Render or Railway.

## What This Project Does

- serves the frontend from the same Node.js server
- lets 2 people join the same room
- exchanges WebRTC signaling messages:
  - `offer`
  - `answer`
  - `ice-candidate`
- supports local testing first
- is structured so TURN can be added later

## Project Files

- `server.js`
  - Express app
  - WebSocket signaling server
  - serves the `public` folder
- `public/index.html`
  - simple UI
- `public/client.js`
  - camera/mic access
  - room join logic
  - WebRTC connection logic
- `package.json`
  - dependencies and start script

## Run Locally

1. Open a terminal in this project folder.
2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open:

```text
http://localhost:3000
```

5. Allow camera and microphone access.

## Deploy To Render

1. Push this project to GitHub.
2. Go to [Render](https://render.com/).
3. Create a new `Web Service`.
4. Connect your GitHub repo.
5. Use these settings:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
```

6. Render will provide a `PORT` environment variable automatically.
7. Deploy the service.
8. Open the Render URL after deploy finishes.

Optional health check path:

```text
/health
```

## Deploy To Railway

1. Push this project to GitHub.
2. Go to [Railway](https://railway.app/).
3. Create a new project.
4. Choose `Deploy from GitHub repo`.
5. Select this repo.
6. Railway should detect Node.js automatically.
7. It will run the app with:

```text
npm start
```

8. Railway also provides `PORT` automatically.
9. Open the generated Railway domain after deploy finishes.

## Environment Variables

This app already supports:

```text
PORT
TURN_URLS
TURN_USERNAME
TURN_CREDENTIAL
```

In `server.js`:

```js
const port = process.env.PORT || 3000;
```

That means:

- local development uses `3000`
- Render/Railway production uses their assigned port automatically

TURN environment variables work like this:

```text
TURN_URLS=turn:your-turn-server.example.com:3478
TURN_USERNAME=your-username
TURN_CREDENTIAL=your-password
```

If you have multiple TURN URLs, separate them with commas:

```text
TURN_URLS=turn:turn1.example.com:3478,turn:turn2.example.com:3478
```

## Important Production Notes

### HTTPS

For real browser-based audio/video calling on the public internet, HTTPS is important.

Why:

- browsers usually require a secure origin for camera and microphone
- `localhost` is allowed for local testing
- real deployed apps should use `https://`
- WebSocket should then use `wss://`

Good news:

- Render and Railway normally provide HTTPS for the public app URL
- the client code already switches automatically between `ws://` and `wss://`

### STUN

STUN helps browsers discover their public-facing network route so they can try
to connect directly.

This project already includes public STUN servers in `public/client.js`.

### TURN

TURN is what helps when direct peer-to-peer connection is blocked.

Without TURN:

- some users will still fail to connect
- strict corporate networks may block calls
- hotel Wi-Fi may block calls
- some mobile carriers may block direct peer-to-peer paths
- users behind difficult NAT/firewall setups may fail

For real production use, you should add a TURN server.

## How TURN Config Works In This Project

TURN values are not hardcoded into `public/index.html`.

Instead:

- `server.js` reads TURN values from environment variables
- `server.js` exposes them to the browser through `/config.js`
- `public/client.js` reads `window.APP_CONFIG`

This is safer than committing TURN credentials into frontend source files.

Important beginner note:

- if the browser needs TURN to make a call, the browser must receive those
  TURN credentials at runtime
- that means a user can still see them in browser DevTools
- so this setup protects secrets from your repo and source control, but not
  from the browser session itself
- for many WebRTC apps this is normal, but in more advanced setups teams often
  use temporary TURN credentials instead of long-lived ones

## How To Add TURN On Render Or Railway

Set these environment variables in your hosting dashboard:

```text
TURN_URLS=turn:your-turn-server.example.com:3478
TURN_USERNAME=your-username
TURN_CREDENTIAL=your-password
```

Then redeploy or restart the service.

## How To Test Two Real Devices

1. Deploy the app to Render or Railway.
2. Open the deployed HTTPS URL on both devices.
3. Allow camera and microphone on both devices.
4. Enter the same room ID on both devices.
5. Click `Join Room` on both devices.
6. Click `Start Call` on one device.

If the call does not connect:

- check browser console logs
- verify both devices are in the same room
- try different networks
- add TURN for better reliability

## What To Do Next For Production

- add a real TURN server
- move TURN credentials into environment variables or a safer config flow
- add basic rate limiting
- add better error UI
- add reconnect logic
- add monitoring/logging
- add room protection or temporary tokens
