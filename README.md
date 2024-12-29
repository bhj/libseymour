# libseymour

Although Google Reader was discontinued in 2013, its API (also known as the GReader API) remains a de facto standard for interoperability among RSS/Atom feed aggregators and clients.

**libseymour** is a TypeScript library that aims to make interacting with the API easier, document it, and encourage the development of more web-based RSS clients. [See the full documentation](https://bhj.github.io/libseymour/modules.html).

- Abstracts the API to simple promise-based getters and setters
- Automatically handles POST tokens (used for mutation requests)
- Automatically converts timestamps contained in strings to numbers
- Provides inline documentation via TypeScript
- ESM package with zero dependencies

## Getting Started

 ```sh
 $ npm i libseymour
 ```

```ts
 import Reader from 'libseymour'
 
 const api = new Reader({ url: 'https://www.example.com/api/greader' })
 ```

## Documentation
 
[See the full documentation](https://bhj.github.io/libseymour/modules.html).
 
## Terminology

- **Feed**: an RSS/Atom URL
- **Item**: an individual article/post
- **Stream**: a list of items
- **Tag**: a generic term used by this library, referring to either:
  - a user-created tag (typically a "category" or "folder" when applied to a *feed*, or a "label" when applied to an *item*)
  - a state (`all`, `read`, or `starred`)

## Stream IDs

Streams are lists of *items* based on some criteria, such as items from a particular *feed* or having a specific *tag*. The Google Reader API refers to these using *Stream IDs*, which can take the following forms:

| Stream ID | Description |
|-----------|-------------|
| `feed/<feed url>` | Items belonging to a specific feed, where `<feed url>` is a full RSS/Atom feed URL. Example: `feed/http://www.example.com/feed` |
| `user/-/label/<name>` | Items having a specific user-created tag, where `<name>` is the tag’s name. Example: `user/-/label/news`<br><br>With *feeds*, tags are often referred to as "categories" or "folders".<br>With *items*, tags often correspond to  "labels". |
| `user/-/state/com.google/<state>` | Items in a specific state. Possible states include `all`, `read`, and `starred`. Example:  `user/-/state/com.google/starred` |

## Aggregators

These self-hosted RSS/Atom feed aggregators support the GReader/Google Reader API:

- [FreshRSS](https://freshrss.org/)
- [Miniflux](https://miniflux.app)
- [Tiny Tiny RSS](https://tt-rss.org)

## Acknowledgements and Further Reading

- Will Honey's [original](https://github.com/willhoney7/Google-Reader-Library) Google Reader Library
- FreshRSS's [GReader API](https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html)
- The Verge: [Who killed Google Reader?](https://www.theverge.com/23778253/google-reader-death-2013-rss-social)
