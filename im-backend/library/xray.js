const AWSXRay = require("aws-xray-sdk-core");
const AWS = require("aws-sdk");
const devEnvironments = ["dev", "local-dev"];
const xrayEnabled = (process.env.ENV_TYPE && !devEnvironments.includes(process.env.ENV_TYPE));
const logger = require("./logger")("library:xray");
const SqlData = AWSXRay.database.SqlData;

if (process.env.ENV_TYPE == "local-dev") {
    AWS.config.update({endpoint: new AWS.Endpoint(process.env.AWS_ENDPOINT), s3ForcePathStyle: true});
}

if (xrayEnabled) {
    logger.info("X-Ray Capture Enabled");
    AWSXRay.captureHTTPsGlobal(require("http"));
    AWSXRay.captureHTTPsGlobal(require("https"));
    module.exports.http = require("http");
    module.exports.https = require("https");
    module.exports.AWS = AWSXRay.captureAWS(AWS);
    module.exports.axios = require("axios");
} else {
    logger.info("X-Ray Capture Disabled");
    module.exports.http = require("http");
    module.exports.https = require("https");
    module.exports.AWS = AWS;
    module.exports.axios = require("axios");
}

// ExpressJS middleware to extract PDT request headers and added as XRay annotations
module.exports.addXrayAnnotations = (req, res, next) => {
    ['user-name', 'device-name'].forEach(header => {
        if(req.headers[header]) {
            // Sanitizing header as Xray Annotations ignores special characters in key name
            const sanitizedHeader = header.replace(/[^a-zA-Z0-9]/g,'_'); 
            AWSXRay.getSegment().addAnnotation(sanitizedHeader, req.headers[header]);
        }
    })
    next();
}

module.exports.xrayEnabled = xrayEnabled;

/**
 * Creates the data that goes into the SQL tab on the XRay subsegment for this DB query.
 * @param config The database configuration (host, user etc.)
 * @param sql The SQL being executed
 * @param prepared Whether a prepared statement is being used
 */
function createSqlData(config, sql, prepared) {
  const data = new SqlData(null, null, config.user,
    config.host + ':' + config.port + '/' + config.database,
    prepared ? 'statement' : null);

  data.sanitized_query = sql
  return data;
}

/**
 * Creates a proxied version of a DB pool method whose execution is captured and sent to XRay.
 * @param origMethod The original method to delegate to
 * @param methodName The name of the method being instrumented (currently only 'query' is)
 * @param config The database configuration settings.
 */
function createProxiedMethod(origMethod, methodName, config) {
  return function(...args) {
    return new Promise((resolve, reject) => {
      try {
        AWSXRay.captureAsyncFunc(config.database + '@' + config.host, (subSegment) => {
          try {
            if (!subSegment) {
              origMethod.apply(this, args)
                .then(val => resolve(val))
                .catch(err => reject(err));
            } else {
              const [sql, ...values] = args;
              const prepared = values && (values.length > 0);
              subSegment.addSqlData(createSqlData(config, sql, prepared));
              subSegment.namespace = 'remote';
              origMethod.apply(this, args)
                .then(val => {
                  resolve(val);
                  subSegment.close();
                })
                .catch(err => {
                  reject(err);
                  subSegment.close(err);
                });
            }
          } catch(err) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }
}

/**
 * Returns a wrapped mysql2/promise connection pool that instruments certain methods with XRay (currently only 'query').
 */
function instrumentDbPool(pool) {
  if(!xrayEnabled) {
    return pool;
  }

  let cache = {};

  return new Proxy(pool, {

    // In JS, a method invocation consists of a get operation to fetch the actual function
    // that can then be applied. Therefore our proxy must trap get operations and optionally
    // wrap and return the requested method if we wish to instrument it.
    get(target, methodName, receiver) {
      const origMethod = target[methodName];

      // only mysql2's "query" method is currently instrumented
      if(methodName !== 'query') {
        return origMethod;
      }

      // We cache the proxied method as it is stateless and time invariant.
      let method = cache[methodName];
      if(!method) {
        method = createProxiedMethod(origMethod, methodName, target.pool.config.connectionConfig);
        cache[methodName] = method;
      }
      return method;
    }
  });
}

module.exports.instrumentDbPool = instrumentDbPool;
