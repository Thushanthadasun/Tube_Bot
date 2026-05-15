import { Router, type IRouter } from "express";
import healthRouter from "./health";
import youtubeRouter from "./youtube";
import openaiRouter from "./openai";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/youtube", youtubeRouter);
router.use("/openai", openaiRouter);

export default router;
