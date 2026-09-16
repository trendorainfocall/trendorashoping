/**
 * Express `async` route handler-larında yaranan xətaları avtomatik
 * `next(err)`-ə ötürür ki, hər bir route-da ayrıca try/catch yazmaq
 * lazım gəlməsin. Server.js-dəki qlobal error-handler middleware
 * bunları tutub 500 cavabı qaytarır.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
