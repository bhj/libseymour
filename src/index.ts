/**
 * This module's primary/default export is the {@link Reader} class.
 * @module
 */

export interface INewFeed {
  /** The feed's URL. Stream ID form optional. API param='s' */
  url: string
  /** Feed display name/title. API param='t' */
  title?: string
  /** A user tag (often "category" or "folder"), created if it doesn't exist. Stream ID form optional. API param='a' */
  tag?: string
}

export interface IEditFeed {
  /** The feed's ID or URL. Stream ID form optional. API param='s' */
  id: string
  /** Feed display name/title. API param='t' */
  title: string
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
export type StreamType = keyof typeof Reader.STREAM_TYPES

/**
 * Class documentation
 *
 * @categoryDescription Authentication
 * Clients authenticate using API tokens. The *auth* token is used for basic
 * requests (typically HTTP GET) while the *post* token is shorter-lived (to
 * protect against CSRF) and used for mutations (typically HTTP POST).
 *
 * @categoryDescription Feeds
 * Feeds represent RSS/Atom URLs and contain a list of *items*. The API often
 * returns feeds in their *stream ID* form ```feed/<feed url>```, but this form
 * is optional when providing feed URLs using this library.
 *
 * @categoryDescription Items
 * Items represent individual articles/posts from a given *stream* (feed, tag, etc.)
 *
 * @categoryDescription Tags
 * A tag can refer to a label, category, folder, or state such as *unread* or
 * *starred*. Tags can be applied to individual items (typically as labels) as well
 * as feeds/streams (typically as categories, folders, or states).
 */
export default class Reader {
  /** @hidden */
  public static STREAM_TYPES = {
    FEED: 'feed/',
    LABEL: 'user/-/label/',
    STATE: 'user/-/state/com.google/',
  } as const

  private static CLIENT = 'libseymour'
  private static PATH_BASE = '/reader/api/0/'
  private static PATH_AUTH = '/accounts/ClientLogin'
  private static STREAM_PREFIXES = Object.values(Reader.STREAM_TYPES)

  private url: string
  private urlAuth: string
  private tokenAuth: string
  private tokenPost: string
  private client: string

  /**
   * Constructor description
   */
  constructor (config) {
    if (!config.url) throw new Error('url is required')

    this.url = config.url + Reader.PATH_BASE
    this.urlAuth = config.url + Reader.PATH_AUTH
    this.client = config.client || Reader.CLIENT
  }

  /**
   * Retreives an **auth** token for the specified username/password combination.
   * This token will be used for future requests without needing to call setAuthToken().
   *
   * @category Authentication
   */
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

  /**
   * Sets the **auth** token to be used for future requests.
   *
   * @category Authentication
   */
  public setAuthToken (token: string) {
    this.tokenAuth = token
  }

  /**
   * Retreives a short-lived (for CSRF protection) **post** token to be used for mutation requests.
   * This token will be used for future requests without needing to call setPostToken().
   * This method is automatically called once before retrying a mutation request where
   * the API has responded with a 400 or 401 status code.
   *
   * @category Authentication
   */
  public async getPostToken () {
    if (!this.tokenAuth) throw new Error('auth token is not set')

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

  /**
   * Sets the short-lived **post** token to be used for mutation requests.
   *
   * @category Authentication
   */
  public setPostToken (token: string) {
    this.tokenPost = token
  }

  /**
   * Retrieves basic information about the currently-authenticated user.
   *
   * @category Authentication
   */
  public getUserInfo (): Promise<IUserInfo> {
    return this.req({
      url: this.url + 'user-info',
      type: 'json',
    })
  }

  /**
   * @category Feeds
   */
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
   * Note: While the original API supported multiple feeds and tags in a single request,
   * support by contemporary aggregators varies. For simplicity, this method handles one
   * feed and (optional) tag at a time.
   *
   * @param feed - The feed's URL, or an object with `url`, `title` (optional) and `tag` (optional).
   * @category Feeds
   */
  public addFeed (feed: string | INewFeed) {
    if (!['string', 'object'].includes(typeof feed)) throw new Error('url or feed object required')

    const url = typeof feed === 'string' ? feed : feed?.url
    if (!url) throw new Error('url required')

    const params = new URLSearchParams({ ac: 'subscribe' })
    params.append('s', Reader.ensureStream(url, 'FEED'))

    if (typeof feed === 'object') {
      if (feed.title) params.append('t', feed.title)
      if (feed.tag) params.append('a', Reader.ensureStream(feed.tag, 'LABEL'))
    }

    return this._editFeed(params)
  }

  /**
   * Removes one or more feeds.
   *
   * @param feed - A feed ID or URL, or an array of feed IDs or URLs. Stream ID form optional. API param='s'
   * @category Feeds
   */
  public removeFeed (feed: string | string[]) {
    if (!feed) throw new Error('no feed(s) specified')
    if (!Array.isArray(feed)) feed = [feed]

    const params = new URLSearchParams({ ac: 'unsubscribe' })
    feed.forEach(id => params.append('s', Reader.ensureStream(id, 'FEED')))

    return this._editFeed(params)
  }

  /**
   * Renames one or more feeds.
   *
   * @category Feeds
   */
  public renameFeed (feed: IEditFeed | IEditFeed[]): Promise<OKString> {
    if (!feed) throw new Error('feed object(s) required')
    if (!Array.isArray(feed)) feed = [feed]

    const params = new URLSearchParams({ ac: 'edit' })

    feed.forEach((f) => {
      params.append('s', Reader.ensureStream(f.id, 'FEED'))
      params.append('t', f.title ?? '')
    })

    return this._editFeed(params)
  }

  /**
   * Adds a user tag (often a "category" or "folder") to one or more feeds.
   *
   * @category Feeds
   */
  public addFeedTag (feed: string | string[], tag: string): Promise<OKString> {
    return this._editFeedTag(feed, tag, 'add')
  }

  /**
   * Removes a user tag (often a "category" or "folder") from one or more feeds.
   *
   * @category Feeds
   */
  public removeFeedTag (feed: string | string[], tag: string): Promise<OKString> {
    return this._editFeedTag(feed, tag, 'remove')
  }

  /**
   * Retrieves a list of items for a stream.
   *
   * @param streamId - A Stream ID. If the value is not in Stream ID form (e.g. a URL instead)
   * it is assumed to be a feed.
   * @category Items
   */
  public async getItems (streamId: string, opts: IGetFeedItemOpts = {}): Promise<IFeedItemList> {
    if (!streamId) throw new Error('Stream ID required')

    const params = {
      c: opts.continuation || undefined,
      n: typeof opts.num === 'number' ? opts.num : 50,
      r: opts.sort === 'asc' ? 'o' : 'd',
      xt: opts.exclude || undefined,
      ot: typeof opts.sMin == 'number' ? opts.sMin : undefined,
      nt: typeof opts.sMax == 'number' ? opts.sMax : undefined,
    }

    const res = await this.req({
      url: this.url + 'stream/contents/' + encodeURIComponent(Reader.ensureStream(streamId, 'FEED')),
      params,
      type: 'json',
    })

    res.items.forEach((item: IFeedItem) => {
      item.crawlTimeMsec = parseInt(item.crawlTimeMsec as unknown as string, 10)
      item.timestampUsec = parseInt(item.timestampUsec as unknown as string, 10)
    })

    return res
  }

  /**
   * Retrieves a list of items having the specified item IDs.
   *
   * @category Items
   */
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

  /**
   * Retrieves a list of item IDs for a stream.
   *
   * @param streamId - A Stream ID. If the value is not in Stream ID form (e.g. a URL instead)
   * it is assumed to be a feed.
   * @category Items
   */
  public async getItemIds (streamId: string, opts: IGetFeedItemOpts = {}): Promise<string[]> {
    if (!streamId) throw new Error('feed URL or Stream ID required')

    const params = {
      s: Reader.ensureStream(streamId, 'FEED'),
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

  /**
   * Adds one or more tags (user-created or state) to the specified item(s).
   *
   * @param itemId - The item's ID, or an array of item IDs.
   * @param tag - The tag, or an array of tags, to remove. Stream ID form required.
   * @category Items
   */
  public addItemTag (itemId: string | string[], tag: string | string[]) {
    return this._editItemTag(itemId, tag, 'add')
  }

  /**
   * Removes one or more tag (user-created or state) from the specified item(s).
   *
   * @param itemId - The item's ID, or an array of item IDs.
   * @param tag - The tag, or an array of tags, to remove. Stream ID form required.
   * @category Items
   */
  public removeItemTag (itemId: string | string[], tag: string | string[]) {
    return this._editItemTag(itemId, tag, 'remove')
  }

  /**
   * Retrieves a list of available tags.
   *
   * @category Tags
   */
  public async getTags (): Promise<ITag[]> {
    const res = await this.req({
      url: this.url + 'tag/list',
      type: 'json',
    })

    return res.tags
  }

  /**
   * Renames a user-created tag (often a "category" or "folder" for a feed, or "label" for an item)
   *
   * @param tag - Current tag name/id. Stream ID form optional. API param='s'
   * @param newTag - New tag name/id. Stream ID form optional. API param='dest'
   * @category Tags
   */
  public renameTag (tag: string, newTag: string): Promise<OKString> {
    return this.req({
      method: 'POST',
      url: this.url + 'rename-tag',
      params: {
        s: Reader.ensureStream(tag, 'LABEL'),
        dest: Reader.ensureStream(newTag, 'LABEL'),
      },
      type: 'text',
    })
  }

  /**
   * Retrieves a list of streams having unread items.
   */
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

  /**
   * Marks all items in the specified stream as read.
   *
   * @param streamId - The target Stream ID. This can generally be a feed, user-created tag, or state. API param='s'
   * @param usMax - Timestamp (microseconds) for which only items older than this value should be marked as read. API param='dest'
   */
  public async setAllRead (streamId: string, usMax: number): Promise<OKString> {
    if (!Reader.STREAM_PREFIXES.some(p => streamId.startsWith(p))) throw new Error(`Stream ID required (got '${streamId}')`)

    const params = {
      s: streamId,
      ts: typeof usMax === 'number' ? usMax : undefined,
    }

    return this.req({
      method: 'POST',
      url: this.url + 'mark-all-as-read',
      params,
      type: 'text',
    })
  }

  /**
   * A utility method to ensure a string is in Stream ID form. If it is, the string is returned verbatim.
   * If not, the specified stream type's prefix is prepended.
   *
   * @param - The input string.
   * @param - The desired Stream ID form, only if the input is not already in Stream ID form.
   */
  public static ensureStream (input: string, type: StreamType): string {
    if (Reader.STREAM_PREFIXES.some(p => input.startsWith(p))) return input

    const prefix = Reader.STREAM_TYPES[type]
    if (!prefix) throw new Error('invalid stream type')

    return `${prefix}${input}`
  }

  private _editFeed (params): Promise<OKString> {
    return this.req({
      method: 'POST',
      url: this.url + 'subscription/edit',
      params,
      type: 'text',
    })
  }

  private _editFeedTag (feed: string | string[], tag: string, mode: 'add' | 'remove'): Promise<OKString> {
    if (!feed) throw new Error('no feed(s) specified')
    if (!Array.isArray(feed)) feed = [feed]

    const params = new URLSearchParams({ ac: 'edit' })

    feed.forEach((id) => {
      params.append('s', Reader.ensureStream(id, 'FEED'))
    })

    if (mode === 'add') params.append('a', Reader.ensureStream(tag, 'LABEL'))
    if (mode === 'remove') params.append('r', Reader.ensureStream(tag, 'LABEL'))

    return this._editFeed(params)
  }

  private _editItemTag (itemId: string | string[], tag: string | string[], mode: 'add' | 'remove'): Promise<OKString> {
    if (!itemId || !tag || !mode) throw new Error('itemId, tag, and mode required')

    if (!Array.isArray(itemId)) itemId = [itemId]
    if (!Array.isArray(tag)) tag = [tag]

    const params = new URLSearchParams(itemId.map(id => ['i', id]))
    const tagMode = mode === 'add' ? 'a' : 'r'

    tag.forEach((t) => {
      if (!Reader.STREAM_PREFIXES.some(p => t.startsWith(p))) throw new Error(`tags must be in Stream ID form (got '${t}')`)
      params.append(tagMode, t)
    })

    return this.req({
      method: 'POST',
      url: this.url + 'edit-tag',
      params,
      type: 'text',
    })
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
}

export class ApiError extends Error {
  /** The HTTP status code of the response. */
  public status: number

  constructor (message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}
