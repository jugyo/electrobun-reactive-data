# Electrobun Reactive Data

Typed, reactive SQLite for [Electrobun](https://electrobun.dev/) apps. Define queries and mutations in your main process, and keep your React UI up to date across windows.

## Install

Install the package and its pinned peers in an Electrobun application:

```sh
npm install @jugyo/electrobun-reactive-data@0.1.0 electrobun@2.0.1 react@19.1.1 react-dom@19.1.1
```

## Get started

Follow the [getting-started guide](docs/getting-started.md) to configure your app, define SQLite queries and mutations, and connect them to React with `useLiveQuery`. The guide includes the required devkit and Vite setup.

For a working multi-window app, see the [Notes example](examples/notes-consumer).

## Support

The verified native workflow is macOS 14+ on Apple Silicon. Windows, Linux, and Intel Macs are not currently supported.

Version `0.1.0` is an early release. Before 1.0, breaking changes require a new minor version and migration notes. See the [compatibility details](docs/getting-started.md#constraints-and-compatibility) for API constraints and [CONTRIBUTING.md](CONTRIBUTING.md) for development instructions.

## License

[MIT](LICENSE). Includes ideas and source from [@jugyo/reactive-data](https://github.com/jugyo/reactive-data/tree/aae2542fe4ab640d1ac5176b3ff02d8a00a0fb06), with attribution retained in the license.
