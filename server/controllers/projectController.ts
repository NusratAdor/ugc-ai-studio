// @ts-nocheck

import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { prisma } from "../configs/prisma.js";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import path from "path";
import axios from "axios";
import Replicate from "replicate";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_KEY,
});


export const createProject = async (req: Request, res: Response) => {
  let tempProjectId: string;
  const { userId } = req.auth();
  let isCreditDeducted = false;

  const {
    name = "New Project",
    aspectRatio,
    userPrompt,
    productName,
    productDescription,
    targetLength = 5,
  } = req.body;

  const images: any = req.files;

  if (images.length < 2 || !productName) {
    return res.status(400).json({ message: "Please upload at least 2 images" });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.credits < 5) {
    return res.status(402).json({ message: "Insufficient credits" });
  } else {
    await prisma.user
      .update({
        where: { id: userId },
        data: { credits: { decrement: 5 } },
      })
      .then(() => {
        isCreditDeducted = true;
      });
  }

  try {
    // Upload original images to cloudinary
    let uploadedImages = await Promise.all(
      images.map(async (item: any) => {
        let result = await cloudinary.uploader.upload(item.path, {
          resource_type: "image",
        });
        return result.secure_url;
      }),
    );

    const project = await prisma.project.create({
      data: {
        name,
        userId,
        productName,
        productDescription,
        aspectRatio,
        userPrompt,
        targetLength: parseInt(targetLength),
        uploadedImages,
        isGenerating: true,
      },
    });

    tempProjectId = project.id;

    // ✅ Generate image using google/imagen-4 (Replicate free trial)
    const output: any = await replicate.run(
      "google/imagen-4",
      {
        input: {
          prompt: `Professional ecommerce product photo. Person naturally holding and showcasing ${productName}.
          ${productDescription ? `Product details: ${productDescription}.` : ""}
          Photorealistic, studio lighting, high quality, sharp focus, clean background.
          ${userPrompt ? userPrompt : ""}`,
          aspect_ratio: aspectRatio === "16:9" ? "16:9" : "9:16",
          output_format: "png",
        },
      }
    );

    if (!output) {
      throw new Error("Failed to generate image");
    }

    // Download generated image from Replicate URL
    const imageResponse = await axios.get(output, {
      responseType: "arraybuffer",
    });

    const finalBuffer = Buffer.from(imageResponse.data);

    if (!finalBuffer || finalBuffer.length === 0) {
      throw new Error("Failed to download generated image");
    }

    const base64Image = `data:image/png;base64,${finalBuffer.toString("base64")}`;

    // Upload to cloudinary
    const uploadResult = await cloudinary.uploader.upload(base64Image, {
      resource_type: "image",
    });

    await prisma.project.update({
      where: { id: project.id },
      data: {
        generatedImage: uploadResult.secure_url,
        isGenerating: false,
      },
    });

    res.json({ projectId: project.id, message: "Image generated successfully!" });

  } catch (error: any) {
    if (tempProjectId!) {
      await prisma.project.update({
        where: { id: tempProjectId },
        data: { isGenerating: false, error: error.message },
      });
    }

    if (isCreditDeducted) {
      await prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: 5 } },
      });
    }

    Sentry.captureException(error);
    res.status(500).json({ message: error.message });
  }
};

export const createVideo = async (req: Request, res: Response) => {
  const { userId } = req.auth();
  const { projectId } = req.body;
  let isCreditDeducted = false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.credits < 10) {
    return res.status(401).json({ message: "Insufficient credits" });
  }

  await prisma.user
    .update({
      where: { id: userId },
      data: { credits: { decrement: 10 } },
    })
    .then(() => {
      isCreditDeducted = true;
    });

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId, userId },
      include: { user: true },
    });

    if (!project || project.isGenerating) {
      return res.status(404).json({ message: "Generation is in progress" });
    }

    if (project.generatedVideo) {
      return res.status(404).json({ message: "Video already generated" });
    }

    if (!project.generatedImage) {
      throw new Error("Generated image not found");
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { isGenerating: true },
    });

    // ✅ Generate video using minimax/video-01 (Replicate free trial)
    const videoOutput: any = await replicate.run(
      "minimax/video-01",
      {
        input: {
          prompt: `Person showcasing ${project.productName}. 
          ${project.productDescription ? `Product: ${project.productDescription}.` : ""}
          Professional product advertisement, studio lighting, smooth motion, high quality.`,
          first_frame_image: project.generatedImage,
        },
      }
    );

    if (!videoOutput) {
      throw new Error("Failed to generate video");
    }

    // Download video from Replicate URL
    const videoResponse = await axios.get(videoOutput, {
      responseType: "arraybuffer",
    });

    // Save video temporarily to disk
    const filename = `${userId}-${Date.now()}.mp4`;
    const filePath = path.join("videos", filename);
    fs.mkdirSync("videos", { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(videoResponse.data));

    // Upload to cloudinary
    const uploadResult = await cloudinary.uploader.upload(filePath, {
      resource_type: "video",
    });

    await prisma.project.update({
      where: { id: project.id },
      data: {
        generatedVideo: uploadResult.secure_url,
        isGenerating: false,
      },
    });

    // Remove temp video file
    fs.unlinkSync(filePath);

    res.json({
      message: "Video generation completed",
      videoUrl: uploadResult.secure_url,
    });

  } catch (error: any) {
    await prisma.project.update({
      where: { id: projectId, userId },
      data: { isGenerating: false, error: error.message },
    });

    if (isCreditDeducted) {
      await prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: 10 } },
      });
    }

    Sentry.captureException(error);
    res.status(500).json({ message: error.message });
  }
};

export const getAllPublishedProjects = async (req: Request, res: Response) => {
  try {
    const projects = await prisma.project.findMany({
      where: { isPublished: true },
    });
    res.json({ projects });
  } catch (error: any) {
    Sentry.captureException(error);
    res.status(500).json({ message: error.message });
  }
};

export const deleteProject = async (req: Request, res: Response) => {
  try {
    const { userId } = req.auth();
    const { projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, userId },
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    await prisma.project.delete({
      where: { id: projectId },
    });

    res.json({ message: "Project deleted successfully" });

  } catch (error: any) {
    Sentry.captureException(error);
    res.status(500).json({ message: error.message });
  }
};