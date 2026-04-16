import { db } from "./index";
import { roomsTable, departmentsTable } from "./schema";

async function seedExtras() {
  console.log("Seeding rooms...");
  await db.insert(roomsTable).values([
    { name: "Sala Principale", description: "Sala interna principale", sortOrder: 1 },
    { name: "Dehor", description: "Spazio esterno", sortOrder: 2 },
    { name: "Bancone", description: "Posto al bancone", sortOrder: 3 },
  ]).onConflictDoNothing();

  console.log("Seeding departments...");
  await db.insert(departmentsTable).values([
    { name: "Cucina", code: "CUC", productionType: "kitchen" },
    { name: "Bar", code: "BAR", productionType: "bar" },
    { name: "Pizzeria", code: "PIZ", productionType: "kitchen" },
  ]).onConflictDoNothing();

  console.log("Done!");
  process.exit(0);
}

seedExtras().catch(console.error);
