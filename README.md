# homebridge-ademco
Honeywell / Ademco with Envisakit Plugin for [HomeBridge](https://github.com/nfarina/homebridge) (API 2.0)


# Installation

1. Install HoneyAlarmServer (https://github.com/MattTW/HoneyAlarmServer).
2. Install homebridge using `npm install -g homebridge`.
3. Install this plugin using `npm install -g git+https://github.com/johnrosenbaum/homebridge-ademco.git`.
4. Update your configuration file. See configuration sample below.

# Configuration
Edit your `config.json` accordingly. Configuration sample:
 ```
"platforms": [{
    "platform": "Ademco",
    "manufacturer": "Honeywell",
    "model": "Vista 20p",
    "alarmserver" : "http://localhost:8111",
    "pin": "1111"
}]
```

### Advanced Configuration (Optional)
This step is not required. HomeBridge with API 2.0 can handle configurations in the HomeKit app.
```
"platforms": [{
    "platform": "Ademco",
    "manufacturer": "Honeywell",
    "model": "Vista 20p",
    "alarmserver" : "http://localhost:8111",
    "pin": "1111",
    "longPoll": 300,
    "shortPoll": 5,
    "shortPollDuration": 120
}]

```

| Fields            | Description                                                   | Required |
|-------------------|---------------------------------------------------------------|----------|
| platform          | Must always be `Ademco`.                                      | Yes      |
| pin               | Alarm pin.                                                    | Yes      |
| manufacturer      | Either 'Honeywell' or 'Ademco'.                               | No       |
| model             | Model of alarm. Either Vista 15p or Vista 20p.                | No       |
| alarmserver       | Address of HoneyAlarmServer (will otherwise use localhost).   | No       |
| longPoll          | Normal polling interval in `s` (Default 300s).                | No       |
| shortPoll         | Polling interval in `s` when door state changes (Default 5s). | No       |
| shortPollDuration | Duration in `s` to use `shortPoll` (Default 120s).            | No       |
