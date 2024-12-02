export interface INewFeed {
  /** Feed URL. StreamId form optional (feed/<url>). API param='s' */
  url: string
  /** Feed display name/title. API param='t' */
  title?: string
}

export interface INewFeedOpts {
  /** Label/category name/id. StreamId form optional (user/-/label/<tag>). Created if it doesn't exist. API param='a' */
  tag?: string
}

export interface IEditFeed {
  /** Feed URL or streamId. API param='s' */
  id: string
  /** Feed display name/title. API param='t' */
  title: string
}

export interface IEditFeedTagOpts {
  /** Add label/category to feed(s). StreamId form optional (user/-/label/<tagname>). API param='a' */
  add?: string
  /** Remove label/category from feed(s). StreamId form optional (user/-/label/<tagname>). API param='r' */
  remove?: string
}

export interface IGetFeedItemOpts {
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

export interface IAllReadOpts {
  /** Exclude items newer than this timestamp (microseconds); API param='ts' */
  usMax?: number
}

export interface IFeed {
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

export interface IFeedItem {
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

export interface IFeedItemList {
  id: string
  updated: number
  items: IFeedItem[]
}

export interface ITag {
  id: string
  type?: 'folder' | 'tag' | string
}

export interface IUnreadCount {
  count: number
  id: string
  newestItemTimestampUsec: number
}

export interface IUserInfo {
  userEmail?: string
  userId?: string
  userName?: string
  userProfileId?: string
}

export type OKString = Promise<'OK'>

export default class Reader {
  private static CLIENT = 'libseymour'
  private static PATH_BASE = '/reader/api/0/'
  private static PATH_AUTH = '/accounts/ClientLogin'
  private static TAGS = {
    'label': 'user/-/label/',
    'star': 'user/-/state/com.google/starred',
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

  /**
   * Adds a feed.
   *
   * @param feed - The feed's URL, or an object (or array of objects) defining both a feed URL and title. StreamId form is optional for the URL (feed/<url>). API param='s'
   * @param opts - Additional options applied to the feed(s).
   */
  public addFeed (feed: string | INewFeed | INewFeed[], opts: INewFeedOpts = {}) {
    if (!feed) throw new Error('url or feed object(s) required')
    const params = new URLSearchParams({ ac: 'subscribe' })

    if (typeof feed === 'string') {
      params.append('s', Reader.PREFIX_FEED + feed.replace(Reader.PREFIX_FEED_REGEXP, ''))
    } else {
      if (!Array.isArray(feed)) feed = [feed]

      feed.forEach((f) => {
        params.append('s', Reader.PREFIX_FEED + f.url.replace(Reader.PREFIX_FEED_REGEXP, ''))
        params.append('t', f.title ?? '')
      })
    }

    if (opts.tag) {
      params.append('a', Reader.TAGS.label + opts.tag.replace(Reader.PREFIX_LABEL_REGEXP, ''))
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
  public renameFeed (feed: IEditFeed | IEditFeed[]): Promise<OKString> {
    if (!feed) throw new Error('feed object(s) required')
    if (!Array.isArray(feed)) feed = [feed]

    const params = new URLSearchParams({ ac: 'edit' })

    feed.forEach((f) => {
      params.append('s', Reader.PREFIX_FEED + f.id.replace(Reader.PREFIX_FEED_REGEXP, ''))
      params.append('t', f.title ?? '')
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
    if (!streamId) throw new Error('streamId required')

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
    if (!itemId) throw new Error('item id(s) required')
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

  public async setAllRead (streamId: string, opts: IAllReadOpts = {}): Promise<OKString> {
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

  private _setItemTag (itemId: string | string[], tag: string | string[], mode: 'add' | 'remove'): Promise<OKString> {
    if (!itemId || !tag || !mode) throw new Error('itemId, tag, and mode required')

    if (!Array.isArray(itemId)) itemId = [itemId]
    if (!Array.isArray(tag)) tag = [tag]

    const params = new URLSearchParams(itemId.map(id => ['i', id]))
    const tagMode = mode === 'add' ? 'a' : 'r'

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

export class ApiError extends Error {
  public status: number

  constructor (message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}
