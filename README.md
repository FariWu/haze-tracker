# Haze Tracker SG

A small installable web app (PWA) that shows Singapore's PSI by region and can alert you when it crosses a level you choose.

- **24-hour PSI** per region (Central, North, South, East, West) from NEA's `psi` feed.
- **1-hour PSI (estimated)**: NEA does not publish a 1-hour PSI, so it is derived from NEA's 1-hour PM2.5 reading (`pm25` feed) using the PSI PM2.5 breakpoints. It is shown with the raw PM2.5 value.
- **Threshold alert**: pick a region, which reading to watch and a PSI level. You get one notification when it reaches that level, and the alert re-arms once it drops back below.
- **Installable**: web manifest, service worker and icons, so it can be added to a phone's Home Screen and works offline with the last saved readings.

Data: National Environment Agency via [data.gov.sg](https://data.gov.sg) (`https://api-open.data.gov.sg/v2/real-time/api/psi` and `/pm25`).

## Run it

It is a static site with no build step. Serve the folder over HTTPS (service workers and notifications need it; `localhost` also works):

```
python3 -m http.server 8000
```

To host it, enable GitHub Pages (Settings, Pages, deploy from the `main` branch) and open the Pages URL on your phone, then use "Add to Home Screen" (iPhone: Safari, Share, Add to Home Screen).

## Notifications: what to expect

There is no push server, so alerts are checked:

1. whenever the app is open (every 5 minutes and when you return to it), and
2. in the background on Android Chrome/Edge for an installed app, through Periodic Background Sync (roughly hourly, at the browser's discretion).

Alerts are not guaranteed while the app is closed, and iPhones only allow notifications for apps added to the Home Screen (iOS 16.4+). Reliable closed-app alerts would need a small server sending Web Push.

## Files

- `index.html`, `styles.css`, `app.js`: the interface
- `psi.js`: data fetching, PSI bands, estimate and alert logic (shared with the service worker)
- `sw.js`: offline cache and background checks
- `manifest.webmanifest`, `icons/`: install metadata and the app icon (`icons/icon.svg` is the source)
