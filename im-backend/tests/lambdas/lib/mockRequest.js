export function mockRequest(options) {
  const getMethod = jest.fn();

  const mock = {
    app: {},
    baseUrl: "",
    body: {},
    cookies: {},
    fresh: true,
    hostname: "",
    ip: "127.0.0.1",
    ips: [],
    method: "",
    originalUrl: "",
    params: {},
    path: "",
    protocol: "https",
    query: {},
    route: {},
    secure: true,
    signedCookies: {},
    stale: false,
    subdomains: [],
    xhr: true,
    accepts: jest.fn(),
    acceptsCharsets: jest.fn(),
    acceptsEncodings: jest.fn(),
    acceptsLanguages: jest.fn(),
    get: getMethod,
    header: getMethod,
    is: jest.fn(),
    range: jest.fn(),
    ...options,
  };
  return mock;
}
