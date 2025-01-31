import {
  GenericContainer,
  Network,
  waitForContainer,
} from "npm:testcontainers@10.17.2";

const POSTGRES_IMAGE = Deno.env.get("POSTGRES_IMAGE")!;
const FUNCTIONS_IMAGE = Deno.env.get("FUNCTIONS_IMAGE")!;
const SUPAVISOR_IMAGE = Deno.env.get("SUPAVISOR_IMAGE")!;

console.log(
  "Starting test environment:",
  POSTGRES_IMAGE,
  SUPAVISOR_IMAGE,
  FUNCTIONS_IMAGE,
);

// const network = await new Network().start();

/*
const postgres = await new GenericContainer(POSTGRES_IMAGE)
  .withName("postgres-db")
  .withNetwork(network)
  .start();

const supavisor = await new GenericContainer(SUPAVISOR_IMAGE)
  .withName("supavisor")
  .withNetwork(network)
  .start();
*/

const functions = await new GenericContainer(FUNCTIONS_IMAGE)
  .withName("functions")
  // .withNetwork(network)
  .withCopyFilesToContainer([
    {
      source: "./functions_main_entrypoint.ts",
      target: "/home/deno/functions/main/index.ts",
    },
  ])
  .withCopyDirectoriesToContainer([
    {
      source: "../../supabase/functions",
      target: "/home/deno/functions",
    },
  ])
  .withCommand(["start", "--main-service", "/home/deno/functions/main"])
  .start();

console.log(functions.logs());
