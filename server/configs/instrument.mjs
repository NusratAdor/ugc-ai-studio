import * as Sentry from "@sentry/node" 

Sentry.init({
  dsn: "https://2337d365926940680bfa5ca25c40b6e5@o4511193680379904.ingest.de.sentry.io/4511193715376208",
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});