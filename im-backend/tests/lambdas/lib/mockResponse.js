export function mockResponse(options) {
  const setMethod = jest.fn().mockReturnThis();
  const typeMethod = jest.fn().mockReturnThis();
  const mock = {
    app: {},
    headersSent: false,
    locals: {},
    ...options,
  };
  mock.append = jest.fn().mockReturnValue(mock);
  mock.attachment = jest.fn().mockReturnValue(mock);
  mock.clearCookie = jest.fn().mockReturnThis();
  mock.contentType = typeMethod;
  mock.cookie = jest.fn().mockReturnThis();
  mock.download = jest.fn();
  mock.end = jest.fn();
  mock.format = jest.fn().mockReturnThis();
  mock.get = jest.fn();
  mock.header = setMethod;
  mock.json = jest.fn().mockReturnValue(mock);
  mock.jsonp = jest.fn().mockReturnValue(mock);
  mock.links = jest.fn().mockReturnThis();
  mock.location = jest.fn().mockReturnThis();
  mock.redirect = jest.fn();
  mock.render = jest.fn();
  mock.send = jest.fn().mockReturnValue(mock);
  mock.sendFile = jest.fn();
  mock.sendStatus = jest.fn().mockReturnValue(mock);
  mock.set = setMethod;
  mock.status = jest.fn().mockReturnValue(mock);
  mock.type = typeMethod;
  mock.vary = jest.fn().mockReturnThis(mock);
  return mock;
}
