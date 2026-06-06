import { mount, mountDemo } from './ui/app';

// DEV 限定: ?demo=1 で OAuth/Sheets を使わずサンプル画面を表示
if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
  mountDemo();
} else {
  void mount();
}
