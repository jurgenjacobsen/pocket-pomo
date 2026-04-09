![Repository Banner](/assets/banner.png)

[![CI and Quality](https://github.com/jurgenjacobsen/pocket-pomo/actions/workflows/ci-quality.yml/badge.svg)](https://github.com/jurgenjacobsen/pocket-pomo/actions/workflows/ci-quality.yml)
[![wakatime](https://wakatime.com/badge/user/010adc07-6382-419f-87bc-0b3f507ee495/project/74c88b6b-a1bd-4e97-8813-6d1d66b761a6.svg)](https://wakatime.com/badge/user/010adc07-6382-419f-87bc-0b3f507ee495/project/74c88b6b-a1bd-4e97-8813-6d1d66b761a6)
![GitHub last commit (branch)](https://img.shields.io/github/last-commit/jurgenjacobsen/pocket-pomo/main)
![GitHub top language](https://img.shields.io/github/languages/top/jurgenjacobsen/pocket-pomo)
![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/omgbiclcldadbhdfdkkblohlhlfhnnbb)
![Chrome Web Store Size](https://img.shields.io/chrome-web-store/size/omgbiclcldadbhdfdkkblohlhlfhnnbb)


# Pocket Pomo
Pomodoro timer extension for Google Chrome.

## Development

1. Install dependencies:
	- `npm install`
2. Build TypeScript:
	- `npm run build`
3. Load the extension:
	- Open `chrome://extensions`
	- Enable **Developer mode**
	- Click **Load unpacked**
	- Select this project folder (`pocket-pomo`)

## Features

- Focus, short break, and long break cycles
- Start, pause, reset, and skip controls
- Adjustable durations from popup settings
- Timer state persisted in extension storage
- Badge countdown on the extension icon
