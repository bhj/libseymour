interface INewFeed {
  /** Feed URL (automatically prepended with "feed/"). API param='s' */
  url: string
  /** Feed display name/title. API param='t' */
  name?: string
  /** Label/category/folder name, in streamId form (user/-/label/<tagname>). Created if it doesn't exist. API param='a' */
  tagStreamId?: string
}

interface IEditFeed {
  /** Feed URL or streamId. API param='s' */
  id: string
  /** Feed display name/title. API param='t' */
  title: string
}

interface IEditFeedTagOpts {
  /** Add label/category to feed. StreamId form optional (user/-/label/<tagname>). API param='a' */
  add?: string
  /** Remove label/category from feed. StreamId form optional (user/-/label/<tagname>). API param='r' */
  remove?: string
}

interface IGetFeedItemOpts {
  /** Continuation key from a previous request, used to fetch the next batch. API param='c' */
  continuation?: string
  /** Exclude a streamId. API param='xt' */
  exclude?: string
  /** Exclude items newer than this timestamp (seconds); API param='nt' */
  sMax?: number
  /** Exclude items older than this timestamp (seconds); API param='ot' */
  sMin?: number
  /** Number of items per request. Default=50; API param='n' */
  num?: number
  /** Date sort order. Default='desc'; API param='r' */
  sort?: 'asc' | 'desc'
}

interface IAllReadOpts {
  /** Exclude items newer than this timestamp (microseconds); API param='ts' */
  usMax?: number
}

interface IFeed {
  id: string
  title: string
  categories: {
    id: string
    label: string
  }[]
  url: string
  htmlUrl: string
  iconUrl: string
}

interface IFeedItem {
  id: string
  crawlTimeMsec: number
  timestampUsec: number
  published: number
  title: string
  canonical: Array<{
    href: string
  }>
  alternate: Array<{
    href: string
  }>
  categories: string[]
  origin: {
    streamId: string
    htmlUrl: string
    title: string
  }
  summary: {
    content: string
  }
  author: string
}

interface IFeedItemList {
  id: string
  updated: number
  items: IFeedItem[]
}

interface ITag {
  id: string
  type?: 'folder' | string
}

interface IUnreadCount {
  count: number
  id: string
  newestItemTimestampUsec: number
}

interface IUserInfo {
  userEmail?: string
  userId?: string
  userName?: string
  userProfileId?: string
}

type OKString = Promise<'OK'>

class Reader {
  private static CLIENT = 'libseymour'
  private static PATH_BASE = '/reader/api/0/'
  private static PATH_AUTH = '/accounts/ClientLogin'
  private static TAGS = {
    'label': 'user/-/label/',
    'star': 'user/-/state/com.google/starred',
    'read': 'user/-/state/com.google/read',
    'reading-list': 'user/-/state/com.google/reading-list',
  }

  private static PREFIX_FEED = 'feed/'
  private static PREFIX_FEED_REGEXP = new RegExp(`^${Reader.PREFIX_FEED}`, 'i')
  private static PREFIX_LABEL_REGEXP = new RegExp(`^${Reader.TAGS.label}`, 'i')

  private url: string
  private urlAuth: string
  private tokenAuth: string
  private tokenPost: string
  private client: string

  constructor (config) {
    if (!config.url) throw new Error('url is required')

    this.url = config.url + Reader.PATH_BASE
    this.urlAuth = config.url + Reader.PATH_AUTH
    this.client = config.client || Reader.CLIENT
  }

  private req = async function ({ isRetry = false, method = 'GET', headers = {}, params = {}, url, type }, noAuth = false) {
    if (this.tokenAuth && !noAuth) {
      headers['Authorization'] = `GoogleLogin auth=${this.tokenAuth}`
    }

    const searchParams = params instanceof URLSearchParams
      ? params
      : new URLSearchParams(
        Object.entries(params)
          // remove undefined properties and make sure they're strings
          .filter(([, val]) => val !== undefined)
          .map(([key, val]) => [key, String(val)]),
      )

    // add default parameters for GET requests
    if (method === 'GET') {
      searchParams.append('ck', Date.now().toString())
      searchParams.append('output', 'json')
      searchParams.append('client', this.client)

      url = `${url}?${searchParams.toString()}`
    } else if (method === 'POST') {
      // post token is required for (most) POST requests
      if (this.tokenPost) searchParams.append('T', this.tokenPost)

      url = `${url}?client=${encodeURIComponent(this.client)}`
    }

    const res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? searchParams : null,
    })

    if (res.ok) {
      if (type === 'json') return res.json()
      if (type === 'text') return res.text()
      return res
    }

    if (method === 'POST' && !isRetry && (res.status === 400 || res.status === 401)) {
      console.log(`got ${res.status}; requesting token`)
      await this.getPostToken()

      console.log('got token; retrying request')
      return this.req({
        isRetry: true,
        method,
        headers,
        params,
        url,
        type,
      })
    } else {
      const body = await res.text()
      throw new ApiError(body, res.status)
    }
  }

  public async getAuthToken (username: string, password: string) {
    if (!username || !password) {
      throw new Error('missing username or password')
    }

    const res = await fetch(this.urlAuth, {
      method: 'POST',
      body: new URLSearchParams({
        Email: username,
        Passwd: password,
      }),
    })

    const body = await res.text()
    if (!res.ok) throw new ApiError(body, res.status)

    const token = body.split('\n')[2].replace('Auth=', '')
    this.setAuthToken(token)
    return token
  }

  public setAuthToken (token: string) {
    this.tokenAuth = token
  }

  public async getPostToken () {
    if (!this.tokenAuth) throw new Error('auth token required')

    const res = await fetch(this.url + 'token', {
      method: 'GET',
      headers: {
        Authorization: `GoogleLogin auth=${this.tokenAuth}`,
      },
    })

    const body = await res.text()
    if (!res.ok) throw new ApiError(body, res.status)

    this.setPostToken(body)
    return body
  }

  public setPostToken (token: string) {
    this.tokenPost = token
  }

  public async getFeeds (): Promise<IFeed[]> {
    const res = await this.req({
      url: this.url + 'subscription/list',
      type: 'json',
    })

    return res.subscriptions
  }

  public addFeed (feed: string | INewFeed | INewFeed[]) {
    if (!feed) throw new Error('url or feed object(s) required')

    const params = new URLSearchParams({ ac: 'subscribe' })

    if (typeof feed === 'string') {
      params.append('s', Reader.PREFIX_FEED + feed.replace(Reader.PREFIX_FEED_REGEXP, ''))
    } else {
      if (!Array.isArray(feed)) feed = [feed]

      feed.forEach((f) => {
        params.append('s', Reader.PREFIX_FEED + f.url.replace(Reader.PREFIX_FEED_REGEXP, ''))
        params.append('t', f.name?.trim() ?? '')
        // FreshRSS bug: tag only applied to last item; rest go uncategorized
        // https://github.com/FreshRSS/FreshRSS/issues/7012
        params.append('a', f.tagStreamId?.trim() ?? '')
      })
    }

    return this._editFeed(params)
  }

  /** Remove one or more feeds */
  public removeFeed (streamId: string | string[]) {
    if (!streamId) throw new Error('streamId(s) required')
    if (!Array.isArray(streamId)) streamId = [streamId]

    const params = new URLSearchParams({ ac: 'unsubscribe' })
    streamId.forEach(id => params.append('s', Reader.PREFIX_FEED + id.replace(Reader.PREFIX_FEED_REGEXP, '')))

    return this._editFeed(params)
  }

  /** Rename one or more feeds */
  public setFeedName (feed: IEditFeed | IEditFeed[]): Promise<OKString> {
    if (!feed) throw new Error('feed object(s) required')
    if (!Array.isArray(feed)) feed = [feed]

    const params = new URLSearchParams({ ac: 'edit' })

    feed.forEach((f) => {
      params.append('s', Reader.PREFIX_FEED + f.id.replace(Reader.PREFIX_FEED_REGEXP, ''))
      params.append('t', f.title?.trim() ?? '')
    })

    return this._editFeed(params)
  }

  /** Add a tag to, and/or remove a tag from, one or more feeds */
  public setFeedTag (streamId: string | string[], opts: IEditFeedTagOpts = {}): Promise<OKString> {
    if (!streamId) throw new Error('streamId(s) required')
    if (!Array.isArray(streamId)) streamId = [streamId]

    const params = new URLSearchParams({ ac: 'edit' })

    streamId.forEach((id) => {
      params.append('s', Reader.PREFIX_FEED + id.replace(Reader.PREFIX_FEED_REGEXP, ''))
    })

    if (opts.add) params.append('a', Reader.TAGS.label + opts.add.replace(Reader.PREFIX_LABEL_REGEXP, ''))
    if (opts.remove) params.append('r', Reader.TAGS.label + opts.remove.replace(Reader.PREFIX_LABEL_REGEXP, ''))

    return this._editFeed(params)
  }

  public async getItems (streamId: string, opts: IGetFeedItemOpts = {}): Promise<IFeedItemList> {
    const params = {
      c: opts.continuation || undefined,
      n: typeof opts.num === 'number' ? opts.num : 50,
      r: opts.sort === 'asc' ? 'o' : 'd',
      xt: opts.exclude || undefined,
      ot: typeof opts.sMin == 'number' ? opts.sMin : undefined,
      nt: typeof opts.sMax == 'number' ? opts.sMax : undefined,
    }

    const res = await this.req({
      url: this.url + 'stream/contents/' + encodeURIComponent(streamId),
      params,
      type: 'json',
    })

    res.items.forEach((item: IFeedItem) => {
      item.crawlTimeMsec = parseInt(item.crawlTimeMsec as unknown as string, 10)
      item.timestampUsec = parseInt(item.timestampUsec as unknown as string, 10)
    })

    return res
  }

  public async getItemsById (itemId: string | string[]): Promise<IFeedItemList> {
    if (!Array.isArray(itemId)) itemId = [itemId]
    const params = new URLSearchParams(itemId.map(id => ['i', id]))

    const res = await this.req({
      method: 'POST',
      url: this.url + 'stream/items/contents',
      params,
      type: 'json',
    })

    res.items.forEach((item: IFeedItem) => {
      item.crawlTimeMsec = parseInt(item.crawlTimeMsec as unknown as string, 10)
      item.timestampUsec = parseInt(item.timestampUsec as unknown as string, 10)
    })

    return res
  }

  public async getItemIds (streamId: string, opts: IGetFeedItemOpts = {}): Promise<string[]> {
    if (!streamId) throw new Error('streamId required')

    const params = {
      s: streamId,
      c: opts.continuation || undefined,
      n: typeof opts.num === 'number' ? opts.num : 50,
      r: opts.sort === 'asc' ? 'o' : 'd',
      xt: opts.exclude || undefined,
      ot: typeof opts.sMin == 'number' ? opts.sMin : undefined,
      nt: typeof opts.sMax == 'number' ? opts.sMax : undefined,
    }

    const res = await this.req({
      url: this.url + 'stream/items/ids',
      params,
      type: 'json',
    })

    return res.itemRefs.map((ref: { id: string }) => ref.id)
  }

  public async getTags (): Promise<ITag[]> {
    const res = await this.req({
      url: this.url + 'tag/list',
      type: 'json',
    })

    return res.tags
  }

  /**
   * Renames a tag.
   *
   * @param tag - Current label/category name/id. StreamId form optional (user/-/label/<tag>). API param='s'
   * @param newTag - New label/category name/id. StreamId form optional (user/-/label/<tag>). API param='dest'
   */
  public renameTag (tag: string, newTag: string): Promise<OKString> {
    return this.req({
      method: 'POST',
      url: this.url + 'rename-tag',
      params: {
        s: Reader.TAGS.label + tag.replace(Reader.PREFIX_LABEL_REGEXP, ''),
        dest: Reader.TAGS.label + newTag.replace(Reader.PREFIX_LABEL_REGEXP, ''),
      },
      type: 'text',
    })
  }

  public async getUnreadCounts (): Promise<IUnreadCount[]> {
    const res = await this.req({
      url: this.url + 'unread-count',
      type: 'json',
    })

    res.unreadcounts.forEach((item: IUnreadCount) => {
      item.newestItemTimestampUsec = parseInt(item.newestItemTimestampUsec as unknown as string, 10)
    })

    return res.unreadcounts
  }

  public getUserInfo (): Promise<IUserInfo> {
    return this.req({
      url: this.url + 'user-info',
      type: 'json',
    })
  }

  public async setAllRead (streamId: string, opts: IAllReadOpts = {}): OKString {
    if (!streamId) throw new Error('streamId required')

    const params = {
      s: streamId,
      ts: typeof opts.usMax == 'number' ? opts.usMax : undefined,
    }

    return this.req({
      method: 'POST',
      url: this.url + 'mark-all-as-read',
      params,
      type: 'text',
    })
  }

  private _editFeed (params): Promise<OKString> {
    return this.req({
      method: 'POST',
      url: this.url + 'subscription/edit',
      params,
      type: 'text',
    })
  }

  private _setItemTag (itemId: string | string[], tag: string | string[], mode: 'add' | 'remove'): OKString {
    if (!itemId || !tag || !mode) throw new Error('itemId, tag, and mode required')
    if (!['add', 'remove'].includes(mode)) throw new Error('mode must be "add" or "remove"')

    if (!Array.isArray(itemId)) itemId = [itemId]
    if (!Array.isArray(tag)) tag = [tag]

    const tagMode = mode === 'add' ? 'a' : 'r'
    const params = new URLSearchParams(itemId.map(id => ['i', id]))
    tag.forEach(t => params.append(tagMode, t))

    return this.req({
      method: 'POST',
      url: this.url + 'edit-tag',
      params,
      type: 'text',
    })
  }

  public addItemTag (itemId: string | string[], tag: string | string[]) {
    return this._setItemTag(itemId, tag, 'add')
  }

  public removeItemTag (itemId: string | string[], tag: string | string[]) {
    return this._setItemTag(itemId, tag, 'remove')
  }
}

export default Reader

class ApiError extends Error {
  public status: number

  constructor (message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

  reader.getLabels = function () {
    return reader.getFeeds().filter(feed => feed.isLabel)
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
}
