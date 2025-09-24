export type PageInfo = {
  title: string | null;
  url: string | null;
  summary: string;
  links: Array<{ text: string; href: string }>;
  status?: number;
};

export const LINK_SCRAPE_JS =
  "Array.from(document.querySelectorAll('a[href]')).slice(0,25).map(a => ({ text: (a.textContent||'').trim().slice(0,80), href: a.href }))";


