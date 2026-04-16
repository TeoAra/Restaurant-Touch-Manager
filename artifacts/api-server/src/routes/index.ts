import { Router, type IRouter } from "express";
import healthRouter from "./health";
import categoriesRouter from "./categories";
import productsRouter from "./products";
import tablesRouter from "./tables";
import ordersRouter from "./orders";
import paymentsRouter from "./payments";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/categories", categoriesRouter);
router.use("/products", productsRouter);
router.use("/tables", tablesRouter);
router.use("/orders", ordersRouter);
router.use("/payments", paymentsRouter);
router.use("/dashboard", dashboardRouter);

export default router;
