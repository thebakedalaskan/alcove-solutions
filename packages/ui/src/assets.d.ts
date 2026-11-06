/* Pictures the kit ships (backgrounds/): the bundler gives each one's URL. */
declare module '*.jpg' {
  const url: string;
  export default url;
}
