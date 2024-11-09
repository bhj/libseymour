/*
  v1.0 - working

  This library requires the support of a localStorage Wrapper I made, however updates could be easily made to change that.

  On Terminology: the API is a little confusing on what it calls things so I made it simple for myself and have set these definitions.
    SUBSCRIPTION - either a label or a feed subscription
    FEED - an individual site's rss feed
    LABEL - a folder/label/category that contains feeds.
    TAGS - the states applied to individual items (read, starred, etc.)
    ITEM - an individual article
*/

/* jslint adsafe: false, devel: true, regexp: true, browser: true, vars: true, nomen: true, maxerr: 50, indent: 4 */
/* global localStorage, window, reader */

(function () {
  'use strict'

  window.reader = {}

  // global constants that will likely be used outside of this file
  reader.TAGS = {
    'like': 'user/-/state/com.google/like',
    'label': 'user/-/label/',
    'star': 'user/-/state/com.google/starred',
    'read': 'user/-/state/com.google/read',
    'fresh': 'user/-/state/com.google/fresh',
    'share': 'user/-/state/com.google/broadcast',
    'kept-unread': 'user/-/state/com.google/kept-unread',
    'reading-list': 'user/-/state/com.google/reading-list',
  }
  // global variables
  reader.has_loaded_prefs = false

  // constants that will only be used in this file
  const CLIENT = 'Tibfib', // put your own string here
    // base urls
    LOGIN_URL = '',
    BASE_URL = '',
    // url paths
    PREFERENCES_PATH = 'preference/stream/list',
    STREAM_PATH = 'stream/contents/',
    SUBSCRIPTIONS_PATH = 'subscription/',
    TAGS_PATH = 'tag/',
    // url actions
    LIST_SUFFIX = 'list',
    EDIT_SUFFIX = 'edit',
    MARK_ALL_READ_SUFFIX = 'mark-all-as-read',
    TOKEN_SUFFIX = 'token',
    USERINFO_SUFFIX = 'user-info',
    UNREAD_SUFFIX = 'unread-count',
    RENAME_LABEL_SUFFIX = 'rename-tag',
    EDIT_TAG_SUFFIX = 'edit-tag'

  let readerFeeds = [] // we want to be able to get/set our feeds outside of this file
  const readerAuth = new localStorageWrapper('Auth') // no interface outside of this file
  const readerUser = new localStorageWrapper('User') // can get from outside of file

  reader.setFeeds = function (feeds) {
    readerFeeds = feeds
  }
  reader.getFeeds = function () {
    return readerFeeds
  }
  reader.getLabels = function () {
    return reader.getFeeds().filter(feed => feed.isLabel)
  }
  reader.getUser = function () {
    // readerUser is an object with user info like the user's email address.
    return readerUser
  }

  // the core ajax function, you won't need to use this directly
  let readerToken = ''
  const requests = []

  const makeRequest = function (obj, noAuth) {
    // make sure we have a method and a parameters object
    obj.method = obj.method || 'GET'
    obj.parameters = obj.parameters || {}

    // add the necessary parameters to get our requests to function properly
    if (obj.method === 'GET') {
      obj.parameters.ck = Date.now() || new Date().getTime()
      obj.parameters.accountType = 'GOOGLE'
      obj.parameters.service = 'reader'
      obj.parameters.output = 'json'
      obj.parameters.client = CLIENT
    }

    // if we have a token, add it to the parameters
    if (readerToken && obj.method === 'POST') {
      // it seems that "GET" requests don't care about your token
      obj.parameters.T = readerToken
    }

    // turn our parameters object into a query string
    const queries = []

    function getQueries(objectToSearch) {
      for (const key in objectToSearch) {
        if (Object.hasOwn(objectToSearch, key)) {
          // console.log("key", key);
          if (key === 'set') {
            // for some requests, you can send the same keys sequentially ex: ?i=2&s=dog&i=4&s=cat ...
            // we support this, but you have to pass the keys that get listed multiple times as a set array of objects.
            // set: [{i: 2, s: "dog"}, {i: 4, s: "cat"}];
            objectToSearch[key].forEach((singleSet) => {
              getQueries(singleSet)
            })
          }
          else {
            queries.push(encodeURIComponent(key) + '=' + encodeURIComponent(objectToSearch[key]))
          }
        }
      }
    }

    getQueries(obj.parameters)
    const queryString = queries.join('&')

    // for get requests, attach the queryString
    // for post requests, attach just the client constant
    const url = (obj.method === 'GET') ? (obj.url + '?' + queryString) : (obj.url + '?' + encodeURIComponent('client') + '=' + encodeURIComponent(CLIENT))

    const request = new XMLHttpRequest()
    request.open(obj.method, url, true)

    // set request header
    request.setRequestHeader('Content-type', 'application/x-www-form-urlencoded')

    if (readerAuth.get() && !noAuth) {
      // this one is important. This is how google does authorization.
      request.setRequestHeader('Authorization', 'GoogleLogin auth=' + readerAuth.get())
    }

    const requestIndex = requests.length
    request.onreadystatechange = function () {
      if ((request.readyState === 4) && request.status === 200) {
        if (obj.onSuccess) {
          obj.onSuccess(request)
          if (requests[requestIndex]) {
            delete requests[requestIndex]
          }
        }
      }
      else if (request.readyState === 4) {
        if (obj.method === 'POST') {
          if (!obj.tried) {
            // If it failed and this is a post request, try getting a new token, then do the request again
            reader.getToken(function () {
              obj.tried = true
              makeRequest(obj)
              if (requests[requestIndex]) {
                delete requests[requestIndex]
              }
            }, obj.onFailure)
          }
        }
        else {
          if (obj.onFailure) {
            obj.onFailure(request)
            if (requests[requestIndex]) {
              delete requests[requestIndex]
            }
          }
        }
        if (request.status === 401 && request.statusText === 'Unauthorized') {
          console.error('AUTH EXPIRED? TRY LOGGING IN AGAIN')
        }

        console.error('Request Failed: ' + request)
      }
    }

    request.send((obj.method === 'POST') ? queryString : '')
    requests.push(request)
  }

  // *************************************
  // *
  // *  Authentication
  // *
  // *************************************

  // First order of business is to check for the Auth Header.
  // If it exists, call getToken();
  // If it doesn't, prompt the user for their username/password
  reader.hasAuth = function () {
    if (readerAuth.get()) {
      return true
    }
  }

  // Get our auth header; saved to localStorage.
  reader.login = function (email, password, successCallback, failCallback) {
    if (email.length === 0 || password.length === 0) {
      failCallback('Blank Info...')
      return
    }
    makeRequest({
      method: 'GET',
      url: LOGIN_URL,
      parameters: {
        Email: email,
        Passwd: password,
      },
      onSuccess: function (transport) {
        // this is what authorizes every action the user takes
        readerAuth.set(transport.responseText.split('\n')[2].replace('Auth=', ''))
        console.log('login success', transport)
        getUserInfo(successCallback, failCallback)
      },
      onFailure: function (transport) {
        console.error(transport)
        // failCallback(reader.normalizeError(transport.responseText));
      },
    })
  }

  // Gets our token for POST requests; saved to localStorage;.
  // If it fails, your auth header has expired and you need to have the user login again.
  reader.getToken = function (successCallback, failCallback) {
    makeRequest({
      method: 'GET',
      url: BASE_URL + TOKEN_SUFFIX,
      parameters: {},
      onSuccess: function (transport) {
        readerToken = transport.responseText
        successCallback()
      },
      onFailure: function (transport) {
        console.error('failed', transport)
        if (failCallback) {
          failCallback(reader.normalizeError(transport.responseText))
        }
      },
    })
  }

  // Logout the user
  reader.logout = function () {
    // delete localStorage.Auth;
    readerAuth.del()
    // delete localStorage.User;
    readerUser.del()

    reader.setFeeds([])
  }

  // Gets the user info, an object of data. Needed for our other requests.
  const getUserInfo = function (successCallback, failCallback) {
    makeRequest({
      method: 'GET',
      url: BASE_URL + USERINFO_SUFFIX,
      parameters: {},
      onSuccess: function (transport) {
        readerUser.set(JSON.parse(transport.responseText))

        successCallback()
      },
      onFailure: function (transport) {
        console.error(transport)
        if (failCallback) {
          failCallback(reader.normalizeError(transport.responseText))
        }
      },
    })
  }

  const getUserPreferences = function (successCallback, failCallback) {
    makeRequest({
      method: 'GET',
      url: BASE_URL + PREFERENCES_PATH,
      parameters: {},
      onSuccess: function (transport) {
        reader.has_loaded_prefs = true
        reader.userPrefs = JSON.parse(transport.responseText).streamprefs
        if (successCallback) {
          successCallback()
        }
      },
      onFailure: function (transport) {
        console.error(transport)
        if (failCallback) {
          failCallback(reader.normalizeError(transport.responseText))
        }
      },
    })
  }

  // *************************************
  // *
  // *  Loading Feeds
  // *
  // *************************************

  // Get the user's subscribed feeds, organizes them in a nice little array.
  reader.loadFeeds = function (successCallback) {
    function loadFeeds() {
      makeRequest({
        method: 'GET',
        url: BASE_URL + SUBSCRIPTIONS_PATH + LIST_SUFFIX,
        onSuccess: function (transport) {
          // save feeds in an organized state.

          loadLabels(function (labels) {
            // get unread counts
            getUnreadCounts(function (unreadcounts) {
              // organize and save feeds
              reader.setFeeds(
                organizeFeeds(
                  JSON.parse(transport.responseText).subscriptions,
                  labels,
                  unreadcounts,
                  reader.userPrefs,
                ),
              )

              // callback with our feeds
              successCallback(reader.getFeeds())
            })
          })
        },
        onFailure: function (transport) {
          console.error(transport)
        },
      })
    }
    if (reader.has_loaded_prefs) {
      loadFeeds()
    }
    else {
      getUserPreferences(loadFeeds)
    }
  }

  const loadLabels = function (successCallback) {
    makeRequest({
      method: 'GET',
      url: BASE_URL + TAGS_PATH + LIST_SUFFIX,
      onSuccess: function (transport) {
        // save feeds in an organized state.
        successCallback(JSON.parse(transport.responseText).tags)
      },
      onFailure: function (transport) {
        console.error(transport)
      },
    })
  }

  // organizes feeds based on labels.
  const organizeFeeds = function (feeds, inLabels, unreadCounts, userPrefs) {
    const unlabeled = []
    const labels = inLabels.filter(label =>
      reader.correctId(label.id) !== 'user/-/state/com.google/broadcast'
      && reader.correctId(label.id) !== 'user/-/state/com.blogger/blogger-following',
    )

    labels.unshift({ title: 'All', id: reader.TAGS['reading-list'], feeds: feeds, isAll: true, isSpecial: true })

    const labelTitleRegExp = /[^/]+$/i

    labels.forEach(function (label) {
      label.title = label.title || labelTitleRegExp.exec(label.id)[0]

      // based on title add unique properties
      if (label.title === 'starred') {
        label.title = label.title.charAt(0).toUpperCase() + label.title.slice(1).toLowerCase()
        label.isSpecial = true
      }
      else if (!label.isSpecial) {
        label.isLabel = true
      }

      label.feeds = []

      // remove digits from the id
      label.id = reader.correctId(label.id)

      // apply unreadCounts
      unreadCounts.forEach(function (unreadCount) {
        unreadCount.id = reader.correctId(unreadCount.id)

        if (label.id === unreadCount.id) {
          label.count = unreadCount.count
          label.newestItemTimestamp = unreadCount.newestItemTimestampUsec
        }
      })
    })

    // process feeds
    feeds.forEach(function (feed) {
      // give isFeed property, useful for identifying
      feed.isFeed = true

      // replace digits from the id
      feed.id = reader.correctId(feed.id)

      // apply unread counts
      unreadCounts.forEach(function (unreadCount) {
        if (feed.id === unreadCount.id) {
          feed.count = unreadCount.count
          feed.newestItemTimestamp = unreadCount.newestItemTimestampUsec
        }
      })

      if (feed.categories.length === 0) {
        // if the feed has no labels, push it onto the unlabeled array
        unlabeled.push(feed)
      }
      else {
        // otherwise find the label from the labels array and push the feed into its feeds array
        feed.categories.forEach(function (label) {
          label.id = reader.correctId(label.id)

          labels.forEach(function (fullLabel) {
            if (label.id === fullLabel.id) {
              const feed_clone = { ...feed }
              feed_clone.inside = fullLabel.id

              fullLabel.feeds.push(feed_clone)
            }
          })
        })
      }
    })

    // replace digits
    userPrefs.forEach(function (value, key) {
      if (/user\/\d*\//.test(key)) {
        userPrefs[reader.correctId(key)] = value
      }
    })

    // remove labels with no feeds
    const labelsWithFeeds = labels.filter(label => label.feeds.length !== 0 || label.isSpecial)

    // order the feeds within labels
    labelsWithFeeds.forEach(function (label) {
      // get the ordering id based on the userPrefs
      const orderingId = userPrefs[label.id].find(setting => setting.id === 'subscription-ordering')

      if (orderingId) {
        label.feeds = label.feeds.sort((feedA, feedB) => {
          const indexA = orderingId.value.indexOf(feedA.sortid)
          const indexB = orderingId.value.indexOf(feedB.sortid)

          // return the index of our feed sortid, which will be in multiples of 8 since sortid's are 8 characters long.
          const rankA = indexA === -1 ? 1000 : indexA / 8
          const rankB = indexB === -1 ? 1000 : indexB / 8

          return rankA - rankB
        })
      }
      // there might be another setting we should follow like "alphabetical" or "most recent". Just a guess.
      /* else {
        labels.feeds.sort();
      } */
    })

    // now order ALL feeds and labels
    const orderingId = userPrefs['user/-/state/com.google/root'].find(setting => setting.id === 'subscription-ordering') || { value: '' }

    // our subscriptions are our labelsWithFeeds + our unlabeled feeds
    let subscriptions = [].concat(labelsWithFeeds, unlabeled)

    // sort them by sortid
    subscriptions = subscriptions.sort((subA, subB) => {
      const indexA = orderingId.value.indexOf(subA.sortid)
      const indexB = orderingId.value.indexOf(subB.sortid)

      const rankA = (indexA === -1 && !subA.isSpecial) ? 1000 : indexA / 8
      const rankB = (indexB === -1 && !subB.isSpecial) ? 1000 : indexB / 8

      return rankA - rankB
    })

    return subscriptions
  }

  // get unread counts from google reader
  const getUnreadCounts = function (successCallback, returnObject) {
    // passing true for returnObject gets you an object useful for notifications
    makeRequest({
      url: BASE_URL + UNREAD_SUFFIX,
      onSuccess: function (transport) {
        const unreadCounts = JSON.parse(transport.responseText).unreadcounts
        // console.log(transport);
        const unreadCountsObj = {}
        unreadCounts.forEach(function (obj) {
          unreadCountsObj[reader.correctId(obj.id)] = obj.count
        })
        reader.unreadCountsObj = unreadCountsObj

        if (returnObject) {
          successCallback(unreadCountsObj)
        }
        else {
          successCallback(unreadCounts)
        }
      },
      onFailure: function (transport) {
        console.error(transport)
      },
    })
  }

  // *************************************
  // *
  // *  Editing Feeds
  // *
  // *************************************

  const editFeed = function (params, successCallback, failCallback) {
    if (!params) {
      console.error('No params for feed edit')
      return
    }

    makeRequest({
      method: 'POST',
      url: BASE_URL + SUBSCRIPTIONS_PATH + EDIT_SUFFIX,
      parameters: params,
      onSuccess: function (transport) {
        successCallback(transport.responseText)
      },
      onFailure: function (transport) {
        console.error(transport)
        if (failCallback)
          failCallback(transport)
      },
    })
  }

  // edit feed title
  reader.editFeedTitle = function (feedId, newTitle, successCallback, failCallback) {
    editFeed({
      ac: 'edit',
      t: newTitle,
      s: feedId,
    }, successCallback, failCallback)
  }
  reader.editFeedLabel = function (feedId, label, opt, successCallback, failCallback) {
    // label needs to have reader.TAGS["label"] prepended.

    const obj = {
      ac: 'edit',
      s: feedId,
    }
    if (opt) {
      obj.a = label
    }
    else {
      obj.r = label
    }
    editFeed(obj, successCallback, failCallback)
  }

  reader.editLabelTitle = function (labelId, newTitle, successCallback, failCallback) {
    // label needs to have reader.TAGS["label"] prepended.

    makeRequest({
      method: 'POST',
      url: BASE_URL + RENAME_LABEL_SUFFIX,
      parameters: {
        s: labelId,
        t: labelId,
        dest: reader.TAGS['label'] + newTitle,
      },
      onSuccess: function (transport) {
        successCallback(transport.responseText)
      },
      onFailure: function (transport) {
        console.error(transport)
        if (failCallback)
          failCallback()
      },

    })
  }

  reader.markAllAsRead = function (subscriptionId, successCallback) {
    // feed or label
    makeRequest({
      method: 'POST',
      url: BASE_URL + MARK_ALL_READ_SUFFIX,
      parameters: {
        s: subscriptionId,
      },
      onSuccess: function (transport) {
        successCallback(transport.responseText)
      },
      onFailure: function (transport) {
        console.error(transport)
      },

    })
  }

  // *************************************
  // *
  // *  Adding/Removing Feeds
  // *
  // *************************************

  reader.unsubscribeFeed = function (feedId, successCallback) {
    editFeed({
      ac: 'unsubscribe',
      s: feedId,
    }, successCallback)
  }

  reader.subscribeFeed = function (feedUrl, successCallback, title) {
    editFeed({
      ac: 'subscribe',
      s: 'feed/' + feedUrl,
      t: title || undefined,
    }, successCallback)
  }

  // *************************************
  // *
  // *  Loading Items
  // *
  // *************************************

  reader.getItems = function (feedUrl, successCallback, opts) {
    const params = opts || { n: 50 }
    params.r = params.r || 'd'

    makeRequest({
      method: 'GET',
      url: BASE_URL + STREAM_PATH + encodeURIComponent(feedUrl),
      parameters: params, /* {
        //ot=[unix timestamp] : The time from which you want to retrieve items. Only items that have been crawled by Google Reader after this time will be returned.
        //r=[d|n|o] : Sort order of item results. d or n gives items in descending date order, o in ascending order.
        //xt=[exclude target] : Used to exclude certain items from the feed. For example, using xt=user/-/state/com.google/read will exclude items that the current user has marked as read, or xt=feed/[feedurl] will exclude items from a particular feed (obviously not useful in this request, but xt appears in other listing requests).
      }, */
      onSuccess: function (transport) {
        successCallback(JSON.parse(transport.responseText).items)
      },
      onFailure: function (transport) {
        console.error(transport)
      },
    })
  }

  // *************************************
  // *
  // *  Editing Items
  // *
  // *************************************

  reader.setItemTag = function (subscriptionId, itemId, tag, add, successCallback, failCallback) {
    // single sub id or array of sub ids (ex: ["subId1", "subId2", ...])
    // single item id or array of item ids in corresponding order of sub ids (ex: ["itemId1", "itemId2", ...])
    // tag in simple form: "like", "read", "share", "label", "star", "kept-unread"
    // add === true, or add === false

    // WARNING: The API seems to fail when you try and change the tags of more than ~100 items.

    const params = {
      async: 'true',
      ac: 'edit-tags',
    }

    if (add === true) {
      params.a = reader.TAGS[tag]
    }
    else {
      params.r = reader.TAGS[tag]
    }

    if (Array.isArray(itemId) && Array.isArray(subscriptionId)) {
      params.set = []
      itemId.forEach((singleItemId, index) => {
        params.set.push({ i: singleItemId, s: subscriptionId[index] })
      })
    }
    else {
      params.s = subscriptionId
      params.i = itemId
    }

    makeRequest({
      method: 'POST',
      url: BASE_URL + EDIT_TAG_SUFFIX,
      parameters: params,
      onSuccess: function (transport) {
        if (transport.responseText === 'OK') {
          successCallback(transport.responseText)
        }
      },
      onFailure: function (transport) {
        console.error('FAILED', transport)
        if (failCallback)
          failCallback()
      },
    })
  }

  // *************************************
  // *
  // *  Useful Utilities
  // *
  // *************************************

  // this function replaces the number id with a dash. Helpful for comparison
  const readerIdRegExp = /user\/\d*\//
  reader.correctId = function (id) {
    return id.replace(readerIdRegExp, 'user/-/')
  }

  const trueRegExp = /^true$/i
  reader.isRead = function (article) {
    if (article.read !== undefined) {
      return trueRegExp.test(article.read)
    }
    for (let i = 0; i < article.categories.length; i++) {
      if (reader.correctId(article.categories[i]) === reader.TAGS['read']) {
        return true
      }
    };

    return false
  }

  reader.isStarred = function (article) {
    if (article.starred !== undefined) {
      return trueRegExp.test(article.starred)
    }
    for (let i = 0; i < article.categories.length; i++) {
      if (reader.correctId(article.categories[i]) === reader.TAGS['star']) {
        return true
      }
    };

    return false
  }

  // returns url for image to use in the icon
  reader.getIconForFeed = function (feedUrl) {
    return 'http://www.google.com/s2/favicons?domain_url=' + encodeURIComponent(feedUrl)
  }

  // normalizes error response for logging in
  reader.normalizeError = function (inErrorResponse) {
    let errorMessage = inErrorResponse.split('\n')[0]
      .replace('Error=', '')
      .replace(/(\w)([A-Z])/g, '$1 $2')

    errorMessage = (errorMessage === 'Bad Authentication') ? 'Incorrect Email/Password' : errorMessage
    return errorMessage
  }
}())

function localStorageWrapper(key) {
  this.key = key
}

localStorageWrapper.prototype.get = function () {
  if (!localStorage[this.key]) {
    return
  }

  try {
    return JSON.parse(localStorage[this.key])
  }
  catch {
    return localStorage[this.key]
  }
}

localStorageWrapper.prototype.set = function (value) {
  try {
    localStorage[this.key] = (typeof value === 'string') ? value : JSON.stringify(value)
  }
  catch {
    console.error('Error Saving to localStorage')
  }
}

localStorageWrapper.prototype.del = function () {
  delete localStorage[this.key]
}
