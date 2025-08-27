const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Ensure uploads folder exists
const uploadDir = "uploads/";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".pdf") return cb(new Error("Only PDF files are allowed"));
    cb(null, true);
  },
});

// Skills list (added EC and EEE)
const SKILLS = [
  "Java", "Python", "JavaScript", "React", "Node", "SQL", "C++", "C#", "AWS",
  "Azure", "GCP", "HTML", "CSS", "Docker", "Kubernetes", "Linux", "Git",
  "Spring", "Django", "Flask", "MongoDB", "PostgreSQL", "MySQL", "NoSQL",
  "Machine Learning", "AI", "Data Science", "Deep Learning", "TensorFlow",
  "PyTorch", "PowerBI", "Tableau", "DevOps", "Jenkins", "CI/CD", "Microservices",
  "Angular", "Vue", "TypeScript", "PHP", "Ruby", "Go", "Swift", "Objective-C",
  "EC", "EEE"
];

// Escape regex special chars
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Parse date safely
function parseDate(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(dateStr);
  return isNaN(parsed) ? null : parsed;
}

// Check if job is posted in last X days
function isRecent(dateStr, days = 7) {
  const postDate = parseDate(dateStr);
  if (!postDate) return false;
  const now = new Date();
  const diffDays = (now - postDate) / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

// POST /upload-cv
app.post("/upload-cv", upload.single("resume"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const dataBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(dataBuffer);
    const extractedText = pdfData.text || "";
    fs.unlinkSync(req.file.path);

    // Extract skills
    const uniqueSkills = SKILLS.filter(skill =>
      new RegExp(`\\b${escapeRegex(skill)}\\b`, "i").test(extractedText)
    );
    console.log("Extracted skills:", uniqueSkills);

    let jobs = [];

    const fetchJobsForSkill = async (skill) => {
      const results = await Promise.allSettled([
        // ---- Arbeitnow ----
        axios.get("https://www.arbeitnow.com/api/job-board-api").then(resp =>
          (resp.data.data || [])
            .filter(job =>
              (job.title.toLowerCase().includes(skill.toLowerCase()) ||
               (job.tags && job.tags.some(tag => tag.toLowerCase().includes(skill.toLowerCase())))) &&
              isRecent(job.created_at)
            )
            .map(job => ({
              title: job.title || "No title",
              company: job.company || "Unknown",
              location: job.location || "Remote",
              url: job.url || "#",
              date: job.created_at || "",
              skill,
            }))
        ),

        // ---- The Muse ----
        axios.get("https://www.themuse.com/api/public/jobs", { params: { category: "Engineering", page: 1 } }).then(resp =>
          (resp.data.results || [])
            .filter(job =>
              (job.name.toLowerCase().includes(skill.toLowerCase()) ||
               (job.contents && job.contents.toLowerCase().includes(skill.toLowerCase()))) &&
              isRecent(job.publication_date)
            )
            .map(job => ({
              title: job.name,
              company: job.company?.name || "Unknown",
              location: job.locations?.map(loc => loc.name).join(", ") || "Remote",
              url: job.refs?.landing_page || "#",
              date: job.publication_date || "",
              skill,
            }))
        ),

        // ---- RemoteOK ----
        axios.get("https://remoteok.io/api").then(resp =>
          (resp.data || [])
            .filter(job =>
              job.position && job.position.toLowerCase().includes(skill.toLowerCase()) &&
              isRecent(job.date)
            )
            .map(job => ({
              title: job.position,
              company: job.company || "Unknown",
              location: job.location || "Remote",
              url: job.url || "#",
              date: job.date || "",
              skill,
            }))
        ),

        // ---- Remotive ----
        axios.get("https://remotive.com/api/remote-jobs", {
          params: { limit: 100 },
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          }
        }).then(resp =>
          (resp.data.jobs || [])
            .filter(job =>
              (job.title.toLowerCase().includes(skill.toLowerCase()) ||
               (job.category && job.category.toLowerCase().includes(skill.toLowerCase()))) &&
              isRecent(job.publication_date)
            )
            .map(job => ({
              title: job.title || "No title",
              company: job.company_name || "Unknown",
              location: job.candidate_required_location || "Remote",
              url: job.url || "#",
              date: job.publication_date || "",
              skill,
            }))
        )
      ]);

      results.forEach((r, idx) => {
        if (r.status === "fulfilled") jobs.push(...r.value);
        else console.warn(`API fetch failed for skill ${skill} (index ${idx}):`, r.reason?.message || r.reason);
      });
    };

    await Promise.all(uniqueSkills.map(skill => fetchJobsForSkill(skill)));

    // Deduplicate jobs by URL
    const uniqueJobs = Array.from(new Map(jobs.map(job => [job.url, job])).values());

    // Sort by most recent date
    uniqueJobs.sort((a, b) => parseDate(b.date) - parseDate(a.date));

    console.log(`Total unique jobs found: ${uniqueJobs.length}`);
    res.json({ skills: uniqueSkills, jobs: uniqueJobs });

  } catch (err) {
    console.error("Resume processing error:", err);
    res.status(500).json({ error: "Failed to process resume", details: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
