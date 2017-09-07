(function(global) {

'use strict';

global.page = page;

page.isSameOrigin = isSameOrigin;
page.Request = Request;
page.Route = Route;
page.pathToRegexp = pathToRegexp;
page.queryString = queryString;
page.Deferred = Deferred;

/**
 * Detect click event
 */
var clickEvent = ('undefined' !== typeof document) && document.ontouchstart ? 'touchstart' : 'click';

/**
 * To work properly with the URL
 * history.location generated polyfill in https://github.com/devote/HTML5-History-API
 */
var location = ('undefined' !== typeof window) && (window.history.location || window.location);

var isArray = isArray || function (arr) {
    return Object.prototype.toString.call(arr) === '[object Array]';
};

/**
 * Decode URL components (query string, pathname, hash).
 * Accommodates both regular percent encoding and x-www-form-urlencoded format.
 */
var decodeURLComponents = true;

/**
 * Decode URL query string into object for every request
 * @type {boolean}
 */
var decodeURLQuery = false;

/**
 * Base path.
 */
var base = '';

/**
 * Running flag.
 */
var running;

/**
 * Previous request, for capturing
 * page exit events.
 */
var previousRequest;

/**
 * Current request
 */
var currentRequest = {
    promise: Deferred().resolve().promise()
};

/**
 * Shortcut for `page.start(options)`.
 * @param {!Object} options
 * @api public
 */
function page(options) {
    page.start(options);
}

/**
 * Callback functions.
 */

var callbacks = [];
var exits = [];
var errorHandlers = [];
var routeNotFoundHandlers = [];

/**
 * Number of pages navigated to.
 * @type {number}
 *
 *     page.len == 0;
 *     page.show('/login');
 *     page.len == 1;
 */
page.len = 0;

/**
 * Returns current request
 * @return {Object}
 */
page.currentRequest = function () {
    return currentRequest;
};

/**
 * Returns current URL without part provided via page.base()
 * @return {string}
 */
page.currentUrlWithoutBase = function () {
    return page.currentRequest().path;
};

/**
 * Returns current URL without part provided via page.base()
 * @return {string}
 */
page.currentUrl = function () {
    return page.currentRequest().canonicalPath;
};

/**
 * Returns previous request
 * @return {Object}
 */
page.previousRequest = function () {
    return previousRequest;
};

/**
 * Returns current URL without part provided via page.base()
 * @return {string}
 */
page.previousUrlWithoutBase = function () {
    return page.previousRequest().path;
};

/**
 * Returns current URL without part provided via page.base()
 * @return {string}
 */
page.previousUrl = function () {
    return page.previousRequest().canonicalPath;
};

/**
 * Get or set basepath to `path`.
 *
 * @param {string} path
 * @api public
 */
page.base = function (path) {
    if (0 === arguments.length) {
        return base;
    }
    base = path;
};

/**
 * Bind with the given `options`.
 *
 * Options:
 *
 *    - `click` - bool, bind to click events [true]
 *    - `popstate` - bool, bind to popstate [true]
 *    - `dispatch` - bool, perform initial dispatch [true]
 *    - `decodeURLComponents` - bool, remove URL encoding from URL components [true]
 *    - `decodeURLQuery` - bool, convert query string to object for each request request [false]
 *
 * @param {Object} options
 * @api public
 */
page.start = function (options) {
    options = options || {};
    if (running) {
        return;
    }
    running = true;
    if (options.decodeURLComponents === false) {
        decodeURLComponents = false;
    }
    if (options.decodeURLQuery) {
        decodeURLQuery = true;
    }
    if (options.popstate !== false) {
        window.addEventListener('popstate', onpopstate, false);
    }
    if (options.click !== false) {
        document.addEventListener(clickEvent, onclick, false);
    }
    page.replace(location.pathname + location.search + location.hash, undefined, options.dispatch !== false, {is_first: true});
};

/**
 * Unbind click and popstate event handlers.
 *
 * @api public
 */
page.stop = function () {
    if (!running) {
        return;
    }
    currentRequest = null;
    previousRequest = null;
    page.len = 0;
    running = false;
    document.removeEventListener(clickEvent, onclick, false);
    window.removeEventListener('popstate', onpopstate, false);
};

/**
 * Declare route.
 * Note: You can pass many fn
 *
 * @param {string} path
 * @param {Function=} fn1
 * @param {Function=} fn2
 * @param {Function=} fnx
 * @api public
 */
page.route = function (path, fn1, fn2, fnx) {
    if (typeof path !== 'string') {
        throw new TypeError('1st argument passed to page.route() must be a string. Use \'*\' if you want to apply callbacks to all routes');
    }
    var route = new Route(path);
    for (var i = 1; i < arguments.length; i++) {
        if (typeof arguments[i] !== 'function') {
            throw new TypeError('argument ' + (i + 1) + ' passed to page.route() for route ' + path + ' is not a funciton');
        }
        callbacks.push(route.middleware(arguments[i], 'route_handler'));
    }
};

/**
 * Register an error handler on `path` with callback `fn()`,
 * which will be called on error during matching request.path
 * @param {string} path
 * @param {Function=} fn
 * @api public
 */
page.error = function (path, fn) {
    if (typeof path === 'function') {
        return page.exit('*', path);
    }

    if (typeof fn !== 'function') {
        throw new TypeError('2nd argument must be a function');
    }

    var route = new Route(path);
    for (var i = 1; i < arguments.length; i++) {
        errorHandlers.push(route.middleware(arguments[i], 'error_handler'));
    }
};

/**
 * Register a page not found handler on `path` with callback `fn()`,
 * which will be called if there is no route that matches request.path
 * but matches provided `path`
 * @param {string} path
 * @param {Function=} fn
 * @api public
 */
page.notFound = function (path, fn) {
    if (typeof path === 'function') {
        return page.exit('*', path);
    }

    if (typeof fn !== 'function') {
        throw new TypeError('2nd argument must be a function');
    }

    var route = new Route(path);
    for (var i = 1; i < arguments.length; i++) {
        routeNotFoundHandlers.push(route.middleware(arguments[i], 'page_not_found_handler'));
    }
};

/**
 * Register an exit route on `path` with callback `fn()`,
 * which will be called on the previous request when a new
 * page is visited.
 */
page.exit = function (path, fn) {
    if (typeof path === 'function') {
        return page.exit('*', path);
    }

    if (typeof fn !== 'function') {
        throw new TypeError('2nd argument must be a function');
    }

    var route = new Route(path);
    for (var i = 1; i < arguments.length; ++i) {
        exits.push(route.middleware(arguments[i], 'exit'));
    }
};

function checkIfStarted() {
    if (!running) {
        throw new Error('Attempt to navigate before router is started');
    }
}

/**
 * Show `path` with optional `state` object.
 *
 * @param {string} path
 * @param {Object=} state
 * @param {boolean=} dispatch
 * @param {boolean=} push
 * @param {Object=} customData
 * @return {!Request}
 * @api public
 */
page.show = function (path, state, dispatch, push, customData) {
    checkIfStarted();
    var request = new Request(path, state, customData);
    processRequest(request, dispatch, push);
    return request;
};

/**
 * Goes back in the history
 * Back should always let the current route push state and then go back.
 *
 * @param {string} fallbackPath - fallback path to go back if no more history exists, if undefined defaults to page.base
 * @param {Object=} state
 * @api public
 */
page.back = function (fallbackPath, state) {
    checkIfStarted();
    if (page.len > 0) {
        currentRequest.promise.always(function () {
            history.back();
            page.len--;
        });
    } else if (fallbackPath) {
        page.show(fallbackPath, state, true, true);
    } else {
        page.show(base, state, true, true);
    }
};

/**
 * Reload current page
 *
 * @api public
 */
page.reload = function () {
    checkIfStarted();
    var url = page.currentUrl();
    if (url === undefined) {
        throw new Error('Attempt to reload page before router has dispatched at least one page')
    }
    page.show(url, null, true, false, {is_reload: true});
};

/**
 * Replace current request request by new one using `path` and optional `state` object.
 *
 * @param {string} path
 * @param {Object=} state
 * @param {boolean=} dispatch
 * @param {Object=} customData
 * @return {Request}
 * @api public
 */
page.replace = function (path, state, dispatch, customData) {
    var request = new Request(path, state, customData);
    request.push = false; //< it does not change url
    currentRequest.promise.always(function () {
        request.saveState(); // save before dispatching, which may redirect
    });
    if (dispatch !== false) {
        request.dispatch();
    }
    return request;
};

/**
 * Restore request.
 *
 * @param {Request=} request
 * @param {boolean=} dispatch
 * @param {boolean=} push
 * @api public
 */
page.restoreRequest = function (request, dispatch, push) {
    if (request.customData) {
        delete request.customData.is_history;
        delete request.customData.is_reload;
        delete request.customData.is_click;
        delete request.customData.target;
        delete request.customData.is_state_save;
    }
    request.is_restore = true;
    page.processRequest(request, dispatch, push);
    delete request.is_restore;
};

/**
 * Execute request.
 *
 * @param {Object=} request
 * @param {boolean=} dispatch
 * @param {boolean=} push
 * @api private
 */
function processRequest(request, dispatch, push) {
    if (push === false) {
        request.push = false;
    }
    if (dispatch !== false) {
        request.dispatch();
    }
}

/**
 * Remove URL encoding from the given `str`.
 * Accommodates whitespace in both x-www-form-urlencoded
 * and regular percent-encoded form.
 *
 * @param {string} val - URL component to decode
 */
function decodeURLEncodedURIComponent(val) {
    if (typeof val !== 'string') {
        return val;
    }
    return decodeURLComponents ? decodeURIComponent(val.replace(/\+/g, ' ')) : val;
}

/**
 * Default handler for requests that do not have matching routes
 * Called only when there is no matching route not found handlers provided via page.notFound(path, fn)
 */
function routeNotFound() {
    var current = document.location.pathname + document.location.search + document.location.hash;
    if (current !== request.canonicalPath) {
        document.location = request.canonicalPath;
    }
}

/**
 * Initialize a new "request" `Request`
 * with the given `path` and optional initial `state`.
 *
 * @constructor
 * @param {string} path
 * @param {Object=} state
 * @param {Object=} customData
 * @api public
 */
function Request(path, state, customData) {
    if ('/' === path[0] && 0 !== path.indexOf(base)) {
        path = base + path;
    }
    var i = path.indexOf('?');

    this.canonicalPath = path;
    this.path = path.replace(base, '') || '/';

    this.title = document.title;
    this.state = state || {};
    this.state.path = path;
    this.querystring = ~i ? decodeURLEncodedURIComponent(path.slice(i + 1)) : '';
    this.pathname = decodeURLEncodedURIComponent(~i ? path.slice(0, i) : path);
    this.params = {};
    this.customData = customData || {};
    this.push = null;
    this.route_found = false;
    this.route_not_found_handled = false;
    this.error = false;
    this.error_handled = false;

    // fragment
    this.hash = '';
    if (~this.path.indexOf('#')) {
        var parts = this.path.split('#');
        this.path = parts[0];
        this.hash = decodeURLEncodedURIComponent(parts[1]) || '';
        this.querystring = this.querystring.split('#')[0];
    }

    if (decodeURLQuery) {
        this.query = queryString(this.querystring);
    }

}

/**
 * Push state.
 *
 * @api private
 */
Request.prototype.pushState = function () {
    page.len++;
    history.pushState(this.state, this.title, this.canonicalPath);
};

/**
 * Save the request state.
 *
 * @api public
 */
Request.prototype.saveState = function () {
    history.replaceState(this.state, this.title, this.canonicalPath);
};

/**
 * Dispatch the given `request`.
 * @return {Deferred.promise}
 * @api public
 */
Request.prototype.dispatch = function () {
    var request = this;
    var deferred = Deferred();
    this.promise = deferred.promise();

    currentRequest.promise.always(function () {
        previousRequest = currentRequest;
        currentRequest = request;

        Deferred
            .queue(
                previousRequest && previousRequest.path ? exits : [],
                previousRequest,
                [previousRequest, request]
            )
            .done(function () {
                Deferred
                    .queue(callbacks, request, [request])
                    .done(function () {
                        deferred.resolve();
                    })
                    .fail(function () {
                        deferred.reject.apply(deferred, arguments);
                    });
            })
            .fail(function () {
                deferred.reject.apply(deferred, arguments);
            });

        request.promise
            .done(function () {
                if (request.route_found) {
                    if (request.push) {
                        request.pushState();
                    }
                } else {
                    Deferred
                        .queue(routeNotFoundHandlers, request, [request])
                        .done(function () {
                            if (!request.route_not_found_handled) {
                                routeNotFound();
                            }
                        });
                }
            })
            .fail(function (error) {
                Deferred
                    .queue(errorHandlers)
                    .done(function () {
                        if (!request.error_handled) {
                            console.error('Error occured while handling a request', request, error);
                            throw Error('Error occured while handling a request')
                        }
                    })
                    .fail(function () {
                        console.error('Error occured while handling a request', request, error);
                        console.error('Error occured while handling a request error', arguments);
                        throw Error('Error occured while handling a request')
                    });
            });
        });

    return request.promise;
};

/**
 * Initialize `Route` with the given HTTP `path`,
 * and an array of `callbacks` and `options`.
 *
 * Options:
 *
 *   - `sensitive`    enable case-sensitive routes
 *   - `strict`       enable strict matching for trailing slashes
 *
 * @constructor
 * @param {string} path
 * @param {Object=} options
 * @api private
 */
function Route(path, options) {
    options = options || {};
    this.is_wildcard = (path === '*');
    this.path = this.is_wildcard ? '(.*)' : path;
    this.method = 'GET';
    this.regexp = pathToRegexp(this.path, this.keys = [], options);
}

/**
 * Return route middleware with
 * the given callback `fn()`.
 *
 * @param {Function} fn
 * @param {string} type - type of function: route_handler, route_not_found_handler, exit, error_handler
 * @return {Function}
 * @api public
 */
Route.prototype.middleware = function (fn, type) {
    var self = this;
    return function (request) {
        var args = arguments;
        return Deferred(function (deferred) {
            if (self.match(request.path, request.params)) {
                // placed here to be able to rollback these values in callbacks
                if (type === 'route_handler' && !self.is_wildcard) {
                    request.route_found = true;
                } else if (type === 'route_not_found_handler') {
                    request.route_not_found_handled = true;
                } else if (type === 'error_handler') {
                    request.error_handled = true;
                }
                try {
                    var ret = fn.apply(request, args);
                    if (typeof ret === 'object' && typeof ret.then === 'function') {
                        ret.then(
                            function () {
                                deferred.resolve();
                            },
                            function () {
                                deferred.reject();
                            }
                        );
                    } else {
                        deferred.resolve();
                    }
                } catch (exc) {
                    deferred.reject(exc);
                }
            } else {
                deferred.resolve();
            }
        });
    };
};

/**
 * Check if this route matches `path`, if so
 * populate `params`.
 *
 * @param {string} path
 * @param {Object} params
 * @return {boolean}
 * @api private
 */
Route.prototype.match = function (path, params) {
    var keys = this.keys,
        qsIndex = path.indexOf('?'),
        pathname = ~qsIndex ? path.slice(0, qsIndex) : path,
        m = this.regexp.exec(decodeURIComponent(pathname));

    if (!m) {
        return false;
    }

    for (var i = 1, len = m.length; i < len; ++i) {
        var key = keys[i - 1];
        var val = decodeURLEncodedURIComponent(m[i]);
        if (val !== undefined || !(Object.prototype.hasOwnProperty.call(params, key.name))) {
            params[key.name] = val;
        }
    }

    return true;
};


/**
 * Handle "populate" events.
 */
var onpopstate = (function () {
    var loaded = false;
    if ('undefined' === typeof window) {
        return;
    }
    if (document.readyState === 'complete') {
        loaded = true;
    } else {
        window.addEventListener('load', function () {
            setTimeout(function () {
                loaded = true;
            }, 0);
        });
    }
    return function onpopstate(e) {
        if (!loaded) {
            return;
        }
        if (e.state) {
            var path = e.state.path;
            page.replace(path, e.state, true, {is_history: true});
        } else {
            page.show(location.pathname + location.hash, undefined, true, false, {is_history: true});
        }
    };
})();

/**
 * Handle "click" events.
 */
function onclick(e) {

    if (1 !== which(e)) {
        return;
    }

    if (e.metaKey || e.ctrlKey || e.shiftKey) {
        return;
    }
    if (e.defaultPrevented) {
        return;
    }


    // ensure link
    // use shadow dom when available
    var el = e.path ? e.path[0] : e.target;
    while (el && 'A' !== el.nodeName) {
        el = el.parentNode;
    }
    if (!el || 'A' !== el.nodeName) {
        return;
    }


    // Ignore if tag has
    // 1. "download" attribute
    // 2. rel="external" attribute
    if (el.hasAttribute('download') || el.getAttribute('rel') === 'external') {
        return;
    }

    // ensure non-hash for the same path
    var link = el.getAttribute('href');
    if (el.pathname === location.pathname && (el.hash || '#' === link)) {
        return;
    }


    // Check for mailto: in the href
    if (link && link.indexOf('mailto:') > -1) {
        return;
    }

    // check target
    if (el.target) {
        return;
    }

    // x-origin
    if (!isSameOrigin(el.href)) {
        return;
    }

    // rebuild path
    var path = el.pathname + el.search + (el.hash || '');

    // same page
    var orig = path;

    if (path.indexOf(base) === 0) {
        path = path.substr(base.length);
    }

    if (base && orig === path) {
        return;
    }

    e.preventDefault();
    page.show(orig, undefined, undefined, undefined, {is_click: true, target: this.activeElement || e.target});
}

/**
 * Event button.
 */
function which(e) {
    e = e || window.event;
    return null === e.which ? e.button : e.which;
}

/**
 * Check if `href` is the same origin.
 */

function isSameOrigin(href) {
    var origin = location.protocol + '//' + location.hostname;
    if (location.port) {
        origin += ':' + location.port;
    }
    return (href && (0 === href.indexOf(origin)));
}

/**
 * Normalize the given path string, returning a regular expression.
 *
 * An empty array can be passed in for the keys, which will hold the
 * placeholder key descriptions. For example, using `/user/:id`, `keys` will
 * contain `[{ name: 'id', delimiter: '/', optional: false, repeat: false }]`.
 *
 * @param  {(String|RegExp|Array)} path
 * @param  {Array}                 [keys]
 * @param  {Object}                [options]
 * @return {RegExp}
 */
function pathToRegexp(path, keys, options) {

    /**
     * Compile a string to a template function for the path.
     *
     * @param  {String}   str
     * @return {Function}
     */
    pathToRegexp.compile = compile;

    /**
     * The main path matching regexp utility.
     *
     * @type {RegExp}
     */
    var PATH_REGEXP = new RegExp([
        // Match escaped characters that would otherwise appear in future matches.
        // This allows the user to escape special characters that won't transform.
        '(\\\\.)',
        // Match Express-style parameters and un-named parameters with a prefix
        // and optional suffixes. Matches appear as:
        //
        // "/:test(\\d+)?" => ["/", "test", "\d+", undefined, "?", undefined]
        // "/route(\\d+)"  => [undefined, undefined, undefined, "\d+", undefined, undefined]
        // "/*"            => ["/", undefined, undefined, undefined, undefined, "*"]
        '([\\/.])?(?:(?:\\:(\\w+)(?:\\(((?:\\\\.|[^()])+)\\))?|\\(((?:\\\\.|[^()])+)\\))([+*?])?|(\\*))'
    ].join('|'), 'g');


    keys = keys || [];

    if (!isArray(keys)) {
        options = keys;
        keys = [];
    } else if (!options) {
        options = {};
    }

    if (path instanceof RegExp) {
        return regexpToRegexp(path, keys);
    }

    if (isArray(path)) {
        return arrayToRegexp(path, keys, options);
    }

    return stringToRegexp(path, keys, options);

    /**
     * Parse a string for the raw tokens.
     *
     * @param  {String} str
     * @return {Array}
     */
    function parseTokens(str) {
        var tokens = [];
        var key = 0;
        var index = 0;
        var path = '';
        var res;

        while ((res = PATH_REGEXP.exec(str)) !== null) {
            var m = res[0];
            var escaped = res[1];
            var offset = res.index;
            path += str.slice(index, offset);
            index = offset + m.length;

            // Ignore already escaped sequences.
            if (escaped) {
                path += escaped[1];
                continue;
            }

            // Push the current path onto the tokens.
            if (path) {
                tokens.push(path);
                path = '';
            }

            var prefix = res[2];
            var name = res[3];
            var capture = res[4];
            var group = res[5];
            var suffix = res[6];
            var asterisk = res[7];

            var repeat = suffix === '+' || suffix === '*';
            var optional = suffix === '?' || suffix === '*';
            var delimiter = prefix || '/';
            var pattern = capture || group || (asterisk ? '.*' : '[^' + delimiter + ']+?');

            tokens.push({
                name: name || key++,
                prefix: prefix || '',
                delimiter: delimiter,
                optional: optional,
                repeat: repeat,
                pattern: escapeGroup(pattern)
            });
        }

        // Match any characters still remaining.
        if (index < str.length) {
            path += str.substr(index);
        }

        // If the path exists, push it onto the end.
        if (path) {
            tokens.push(path);
        }

        return tokens;
    }

    /**
     * Compile a string to a template function for the path.
     *
     * @param  {String}   str
     * @return {Function}
     */
    function compile(str) {
        return tokensToFunction(parseTokens(str));
    }

    /**
     * Expose a method for transforming tokens into the path function.
     */
    function tokensToFunction(tokens) {
        // Compile all the tokens into regexps.
        var matches = new Array(tokens.length);

        // Compile all the patterns before compilation.
        for (var i = 0; i < tokens.length; i++) {
            if (typeof tokens[i] === 'object') {
                matches[i] = new RegExp('^' + tokens[i].pattern + '$');
            }
        }

        return function (obj) {
            var path = '';
            var data = obj || {};

            for (var i = 0; i < tokens.length; i++) {
                var token = tokens[i];

                if (typeof token === 'string') {
                    path += token;

                    continue;
                }

                var value = data[token.name];
                var segment;

                if (value === null) {
                    if (token.optional) {
                        continue;
                    } else {
                        throw new TypeError('Expected "' + token.name + '" to be defined');
                    }
                }

                if (isArray(value)) {
                    if (!token.repeat) {
                        throw new TypeError('Expected "' + token.name + '" to not repeat, but received "' + value + '"');
                    }

                    if (value.length === 0) {
                        if (token.optional) {
                            continue;
                        } else {
                            throw new TypeError('Expected "' + token.name + '" to not be empty');
                        }
                    }

                    for (var j = 0; j < value.length; j++) {
                        segment = encodeURIComponent(value[j]);

                        if (!matches[i].test(segment)) {
                            throw new TypeError('Expected all "' + token.name + '" to match "' + token.pattern + '", but received "' + segment + '"');
                        }

                        path += (j === 0 ? token.prefix : token.delimiter) + segment;
                    }

                    continue;
                }

                segment = encodeURIComponent(value);

                if (!matches[i].test(segment)) {
                    throw new TypeError('Expected "' + token.name + '" to match "' + token.pattern + '", but received "' + segment + '"');
                }

                path += token.prefix + segment;
            }

            return path;
        }
    }

    /**
     * Escape a regular expression string.
     *
     * @param  {String} str
     * @return {String}
     */
    function escapeString(str) {
        return str.replace(/([.+*?=^!:${}()[\]|\/])/g, '\\$1');
    }

    /**
     * Escape the capturing group by escaping special characters and meaning.
     *
     * @param  {String} group
     * @return {String}
     */
    function escapeGroup(group) {
        return group.replace(/([=!:$\/()])/g, '\\$1');
    }

    /**
     * Attach the keys as a property of the regexp.
     *
     * @param  {RegExp} re
     * @param  {Array}  keys
     * @return {RegExp}
     */
    function attachKeys(re, keys) {
        re.keys = keys;
        return re;
    }

    /**
     * Get the flags for a regexp from the options.
     *
     * @param  {Object} options
     * @return {String}
     */
    function flags(options) {
        return options.sensitive ? '' : 'i';
    }

    /**
     * Pull out keys from a regexp.
     *
     * @param  {RegExp} path
     * @param  {Array}  keys
     * @return {RegExp}
     */
    function regexpToRegexp(path, keys) {
        // Use a negative lookahead to match only capturing groups.
        var groups = path.source.match(/\((?!\?)/g);

        if (groups) {
            for (var i = 0; i < groups.length; i++) {
                keys.push({
                    name: i,
                    prefix: null,
                    delimiter: null,
                    optional: false,
                    repeat: false,
                    pattern: null
                });
            }
        }

        return attachKeys(path, keys);
    }

    /**
     * Transform an array into a regexp.
     *
     * @param  {Array}  path
     * @param  {Array}  keys
     * @param  {Object} options
     * @return {RegExp}
     */
    function arrayToRegexp(path, keys, options) {
        var parts = [];

        for (var i = 0; i < path.length; i++) {
            parts.push(convertPathToRegexp(path[i], keys, options).source);
        }

        var regexp = new RegExp('(?:' + parts.join('|') + ')', flags(options));

        return attachKeys(regexp, keys);
    }

    /**
     * Create a path regexp from string input.
     *
     * @param  {String} path
     * @param  {Array}  keys
     * @param  {Object} options
     * @return {RegExp}
     */
    function stringToRegexp(path, keys, options) {
        var tokens = parseTokens(path);
        var re = tokensToRegExp(tokens, options);

        // Attach keys back to the regexp.
        for (var i = 0; i < tokens.length; i++) {
            if (typeof tokens[i] !== 'string') {
                keys.push(tokens[i]);
            }
        }

        return attachKeys(re, keys);
    }

    /**
     * Expose a function for taking tokens and returning a RegExp.
     *
     * @param  {Array}  tokens
     * @param  {Object} options
     * @return {RegExp}
     */
    function tokensToRegExp(tokens, options) {
        options = options || {};

        var strict = options.strict;
        var end = options.end !== false;
        var route = '';
        var lastToken = tokens[tokens.length - 1];
        var endsWithSlash = typeof lastToken === 'string' && /\/$/.test(lastToken);

        // Iterate over the tokens and create our regexp string.
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];

            if (typeof token === 'string') {
                route += escapeString(token);
            } else {
                var prefix = escapeString(token.prefix);
                var capture = token.pattern;

                if (token.repeat) {
                    capture += '(?:' + prefix + capture + ')*';
                }

                if (token.optional) {
                    if (prefix) {
                        capture = '(?:' + prefix + '(' + capture + '))?';
                    } else {
                        capture = '(' + capture + ')?';
                    }
                } else {
                    capture = prefix + '(' + capture + ')';
                }

                route += capture;
            }
        }

        // In non-strict mode we allow a slash at the end of match. If the path to
        // match already ends with a slash, we remove it for consistency. The slash
        // is valid at the end of a path match, not in the middle. This is important
        // in non-ending mode, where "/test/" shouldn't match "/test//route".
        if (!strict) {
            route = (endsWithSlash ? route.slice(0, -2) : route) + '(?:\\/(?=$))?';
        }

        if (end) {
            route += '$';
        } else {
            // In non-ending mode, we need the capturing groups to match as much as
            // possible by using a positive lookahead to the end or next path segment.
            route += strict && endsWithSlash ? '' : '(?=\\/|$)';
        }

        return new RegExp('^' + route, flags(options));
    }

}

/**
 * Parse the given query `str` or `obj`, returning an object.
 *
 * @param {String} str | {Object} obj
 * @return {Object}
 * @api public
 */
function queryString (str) {

    /**
     * Turn the given `obj` into a query string
     *
     * @param {Object|Array} obj
     * @param {string} prefix
     * @return {String}
     */
    queryString.stringify = stringify;

    /**
     * Object#toString() ref for stringify().
     */
    var toString = Object.prototype.toString;

    /**
     * Cache non-integer test regexp.
     */
    var isInt = /^[0-9]+$/;

    if (str === null || str === '') {
        return {};
    }
    return typeof str === 'object' ? parseObject(str) : parseString(str);

    function promote(parent, key) {
        if (parent[key].length === 0) {
            return parent[key] = {};
        }
        var t = {};
        for (var i in parent[key]) {
            t[i] = parent[key][i];
        }
        parent[key] = t;
        return t;
    }

    function parse(parts, parent, key, val) {
        var part = parts.shift();
        // end
        if (!part) {
            if (isArray(parent[key])) {
                parent[key].push(val);
            } else if (typeof parent[key] === 'object') {
                parent[key] = val;
            } else if (typeof parent[key] === 'undefined') {
                parent[key] = val;
            } else {
                parent[key] = [parent[key], val];
            }
            // array
        } else {
            var obj = parent[key] = parent[key] || [];
            if (part === ']') {
                if (isArray(obj)) {
                    if (val !== '') {
                        obj.push(val);
                    }
                } else if (typeof obj === 'object') {
                    obj[Object.keys(obj).length] = val;
                } else {
                    parent[key] = [parent[key], val];
                }
                // prop
            } else if (~part.indexOf(']')) {
                part = part.substr(0, part.length - 1);
                if (!isInt.test(part) && isArray(obj)) {
                    obj = promote(parent, key);
                }
                parse(parts, obj, part, val);
                // key
            } else {
                if (!isInt.test(part) && isArray(obj)) {
                    obj = promote(parent, key);
                }
                parse(parts, obj, part, val);
            }
        }
    }

    /**
     * Merge parent key/val pair.
     */
    function merge(parent, key, val) {
        if (~key.indexOf(']')) {
            parse(key.split('['), parent, 'base', val);
        } else {
            if (!isInt.test(key) && isArray(parent.base)) {
                var t = {};
                for (var k in parent.base) {
                    t[k] = parent.base[k];
                }
                parent.base = t;
            }
            set(parent.base, key, val);
        }

        return parent;
    }

    /**
     * Parse the given obj.
     * @return {Object}
     */
    function parseObject(obj) {
        var ret = {base: {}};
        Object.keys(obj).forEach(function (name) {
            merge(ret, name, obj[name]);
        });
        return ret.base;
    }

    /**
     * Parse the given str.
     * @return {Object}
     */
    function parseString(str) {
        var ret = {base: {}};
        String(str)
            .split('&')
            .reduce(
                function (ret, pair) {
                    try {
                        pair = decodeURIComponent(pair.replace(/\+/g, ' '));
                    } catch (e) {
                        // ignore
                    }

                    var eql = pair.indexOf('=');
                    var brace = lastBraceInKey(pair);
                    var key = pair.substr(0, brace || eql);
                    var val = pair.substr(brace || eql, pair.length);
                    val = val.substr(val.indexOf('=') + 1, val.length);

                    // ?foo
                    if (key === '') {
                        key = pair;
                        val = '';
                    }

                    return merge(ret, key, val);
                },
                ret
            );
        return ret.base;
    }

    /**
     * Turn the given `obj` into a query string
     *
     * @param {Object|Array} obj
     * @param {string} prefix
     * @return {String}
     */
    function stringify(obj, prefix) {
        if (isArray(obj)) {
            return stringifyArray(obj, prefix);
        } else if (toString.call(obj) === '[object Object]') {
            return stringifyObject(obj, prefix);
        } else if (typeof obj === 'string') {
            return stringifyString(obj, prefix);
        } else {
            return prefix + '=' + obj;
        }
    }

    /**
     * Stringify the given `str`.
     *
     * @param {String} str
     * @param {String} prefix
     * @return {String}
     * @api private
     */
    function stringifyString(str, prefix) {
        if (!prefix) {
            throw new TypeError('stringify expects an object');
        }
        return prefix + '=' + encodeURIComponent(str);
    }

    /**
     * Stringify the given `arr`.
     *
     * @param {Array} arr
     * @param {String} prefix
     * @return {String}
     * @api private
     */
    function stringifyArray(arr, prefix) {
        var ret = [];
        if (!prefix) {
            throw new TypeError('stringify expects an object');
        }
        for (var i = 0; i < arr.length; i++) {
            ret.push(stringify(arr[i], prefix + '[' + i + ']'));
        }
        return ret.join('&');
    }

    /**
     * Stringify the given `obj`.
     *
     * @param {Object} obj
     * @param {String} prefix
     * @return {String}
     * @api private
     */
    function stringifyObject(obj, prefix) {
        var ret = [];
        var keys = Object.keys(obj);
        var key;

        for (var i = 0, len = keys.length; i < len; ++i) {
            key = keys[i];
            ret.push(stringify(obj[key], prefix
                ? prefix + '[' + encodeURIComponent(key) + ']'
                : encodeURIComponent(key)));
        }

        return ret.join('&');
    }

    /**
     * Set `obj`'s `key` to `val` respecting
     * the weird and wonderful syntax of a qs,
     * where "foo=bar&foo=baz" becomes an array.
     *
     * @param {Object} obj
     * @param {String} key
     * @param {String} val
     * @api private
     */
    function set (obj, key, val) {
        var v = obj[key];
        if (v === undefined) {
            obj[key] = val;
        } else if (isArray(v)) {
            v.push(val);
        } else {
            obj[key] = [v, val];
        }
    }

    /**
     * Locate last brace in `str` within the key.
     *
     * @param {String} str
     * @return {Number}
     * @api private
     */
    function lastBraceInKey(str) {
        var len = str.length;
        var brace, c;
        for (var i = 0; i < len; ++i) {
            c = str[i];
            if (c === ']') {
                brace = false;
            }
            if (c === '[') {
                brace = true;
            }
            if (c === '=' && !brace) {
                return i;
            }
        }
    }
}

/**
 * Promise/Deferred implementation
 * Source: https://github.com/warpdesign/deferred-js
 * @param {function=} fn
 * @return {promise|deferred}
 * @constructor
 */
function Deferred(fn) {
    var status = 'pending';
    var doneFuncs = [];
    var failFuncs = [];
    var progressFuncs = [];
    var resultArgs = null;

    function foreach(arr, handler) {
        if (isArray(arr)) {
            for (var i = 0; i < arr.length; i++) {
                handler(arr[i]);
            }
        } else {
            handler(arr);
        }
    }

    var promise = {
        done: function () {
            for (var i = 0; i < arguments.length; i++) {
                // skip any undefined or null arguments
                if (!arguments[i]) {
                    continue;
                }

                if (isArray(arguments[i])) {
                    var arr = arguments[i];
                    for (var j = 0; j < arr.length; j++) {
                        // immediately call the function if the deferred has been resolved
                        if (status === 'resolved') {
                            arr[j].apply(this, resultArgs);
                        }

                        doneFuncs.push(arr[j]);
                    }
                }
                else {
                    // immediately call the function if the deferred has been resolved
                    if (status === 'resolved') {
                        arguments[i].apply(this, resultArgs);
                    }

                    doneFuncs.push(arguments[i]);
                }
            }

            return this;
        },

        fail: function () {
            for (var i = 0; i < arguments.length; i++) {
                // skip any undefined or null arguments
                if (!arguments[i]) {
                    continue;
                }

                if (isArray(arguments[i])) {
                    var arr = arguments[i];
                    for (var j = 0; j < arr.length; j++) {
                        // immediately call the function if the deferred has been resolved
                        if (status === 'rejected') {
                            arr[j].apply(this, resultArgs);
                        }

                        failFuncs.push(arr[j]);
                    }
                }
                else {
                    // immediately call the function if the deferred has been resolved
                    if (status === 'rejected') {
                        arguments[i].apply(this, resultArgs);
                    }

                    failFuncs.push(arguments[i]);
                }
            }

            return this;
        },

        always: function () {
            return this.done.apply(this, arguments).fail.apply(this, arguments);
        },

        progress: function () {
            for (var i = 0; i < arguments.length; i++) {
                // skip any undefined or null arguments
                if (!arguments[i]) {
                    continue;
                }

                if (isArray(arguments[i])) {
                    var arr = arguments[i];
                    for (var j = 0; j < arr.length; j++) {
                        // immediately call the function if the deferred has been resolved
                        if (status === 'pending') {
                            progressFuncs.push(arr[j]);
                        }
                    }
                }
                else {
                    // immediately call the function if the deferred has been resolved
                    if (status === 'pending') {
                        progressFuncs.push(arguments[i]);
                    }
                }
            }

            return this;
        },

        then: function () {
            // fail callbacks
            if (arguments.length > 1 && arguments[1]) {
                this.fail(arguments[1]);
            }

            // done callbacks
            if (arguments.length > 0 && arguments[0]) {
                this.done(arguments[0]);
            }

            // notify callbacks
            if (arguments.length > 2 && arguments[2]) {
                this.progress(arguments[2]);
            }
        },

        promise: function (obj) {
            if (!obj) {
                return promise;
            } else {
                for (var i in promise) {
                    obj[i] = promise[i];
                }
                return obj;
            }
        },

        state: function () {
            return status;
        },

        debug: function () {
            console.log('[debug]', doneFuncs, failFuncs, status);
        },

        isRejected: function () {
            return status === 'rejected';
        },

        isResolved: function () {
            return status === 'resolved';
        }
    };

    var deferred = {
        resolveWith: function (context) {
            if (status === 'pending') {
                status = 'resolved';
                var args = resultArgs = (arguments.length > 1) ? arguments[1] : [];
                for (var i = 0; i < doneFuncs.length; i++) {
                    doneFuncs[i].apply(context, args);
                }
            }
            return this;
        },

        rejectWith: function (context) {
            if (status === 'pending') {
                status = 'rejected';
                var args = resultArgs = (arguments.length > 1) ? arguments[1] : [];
                for (var i = 0; i < failFuncs.length; i++) {
                    failFuncs[i].apply(context, args);
                }
            }
            return this;
        },

        notifyWith: function (context) {
            if (status === 'pending') {
                var args = resultArgs = (arguments.length > 1) ? arguments[1] : [];
                for (var i = 0; i < progressFuncs.length; i++) {
                    progressFuncs[i].apply(context, args);
                }
            }
            return this;
        },

        resolve: function () {
            return this.resolveWith(this, arguments);
        },

        reject: function () {
            return this.rejectWith(this, arguments);
        },

        notify: function () {
            return this.notifyWith(this, arguments);
        }
    };

    var obj = promise.promise(deferred);

    if (typeof fn === 'function') {
        fn.apply(obj, [obj]);
    }

    return obj;
}

/**
 * Run functions one by one. Each function MUST return Deferred object
 * @param {Array=} functions
 * @param {Object=} context - context of each funciton
 * @param {Array=} args - arguments to pass to each funciton
 * @return {*}
 */
Deferred.queue = function (functions, context, args) {
    var deferred = Deferred();
    if (!functions) {
        return deferred.resolve();
    }
    if (!isArray(functions)) {
        throw new TypeError('Deferred.queue: argument 1 (functions) must be an array or empty');
    }
    if (!functions.length) {
        return deferred.resolve();
    }
    if (!context) {
        context = deferred;
    } else if (typeof context !== 'object') {
        throw new TypeError('Deferred.queue: argument 2 (context) must be an object or empty');
    }
    if (!args) {
        args = [];
    } else if (!isArray(args)) {
        throw new TypeError('Deferred.queue: argument 3 (args) must be an array or empty');
    }

    var i = 0;
    var next = function () {
        if (i < functions.length) {
            functions[i++]
                .apply(context, args)
                .then(next, deferred.reject);
        } else {
            deferred.resolve();
        }
    };
    next();
    return deferred.promise();
};

})(typeof window !== "undefined" ? window : this);