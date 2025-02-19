import { NavLink, Outlet } from "solid-app-router";
const modules = import.meta.glob("./guides/*.(mdx|md)");
import { For } from "solid-js";
import md from "~/md";

const pathToHumanName = (path: string) =>
  path // ./guides/page-data.md
    .split("/") // [".", "guides", "page-data.md"]
    .at(-1) // "page-data.md"
    .split(".")[0] // "page-data"
    .split("-") // ["page", "data"]
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // ["Page", "Data"]
    .join(" "); // "Page Data"

const pathToLink = (path: string) =>
  `/guides/${
    path // ./guides/page-data.md
      .split("/") // [".", "guides", "page-data.md"]
      .at(-1) // "page-data.md"
      .split(".")[0] // "page-data"
  }`;

const Guides = () => {
  return (
    <div class="flex h-full">
      <ul class="bg-gray-200 h-full p-2 w-max">
        <For each={Object.keys(modules).filter(n => n !== "./guides/index.mdx")}>
          {name => (
            <li class="w-max">
              <NavLink href={pathToLink(name)} class="text-blue-800 block" activeClass="bg-gray-400">
                {pathToHumanName(name)}
              </NavLink>
            </li>
          )}
        </For>
      </ul>
      <div class="p-4">
        <Outlet />
      </div>
    </div>
  );
}; 

export default Guides;
