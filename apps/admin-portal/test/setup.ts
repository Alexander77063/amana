// Component tests run under node; pages read the browser only inside effects, which the render
// helper drives with `act`. Nothing global is needed yet, but the file exists so vitest.config is
// stable when something is.
export {};
