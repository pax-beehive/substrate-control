import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Send } from "lucide-react"
import { toast } from "sonner"

import * as api from "@/lib/api"
import type { Actor, ActorProxyRequest, ActorProxyResponse } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

function statusClasses(status: number): string {
  if (status >= 200 && status < 300) {
    return "border-[#BFDCC7] bg-[#E6F2E8] text-[#2F7D4F] dark:border-[#2F7D4F]/40 dark:bg-[#2F7D4F]/15 dark:text-[#8FC7A6]"
  }
  if (status >= 400 && status < 500) {
    return "border-[#E8D9AC] bg-[#F7EFD4] text-[#8A6D1A] dark:border-[#8A6D1A]/40 dark:bg-[#8A6D1A]/15 dark:text-[#D4B96A]"
  }
  if (status >= 500) {
    return "border-[#EFC4BC] bg-[#F9E4E0] text-[#B23B2E] dark:border-[#B23B2E]/40 dark:bg-[#B23B2E]/15 dark:text-[#E08B7E]"
  }
  return "border-[#DDD9CE] bg-[#EFEDE5] text-[#6B6960] dark:border-[#55524B]/60 dark:bg-[#55524B]/25 dark:text-[#A6A39B]"
}

export function ActorTaskPanel({ actor }: { actor: Actor }) {
  const [method, setMethod] = useState<"GET" | "POST">("POST")
  const [path, setPath] = useState("/ask")
  const [body, setBody] = useState("")
  const [response, setResponse] = useState<ActorProxyResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState("")

  const mutation = useMutation({
    mutationFn: (req: ActorProxyRequest) =>
      api.proxyActorRequest(actor.atespace, actor.name, req),
    onSuccess: (data) => {
      setResponse(data)
      setErrorMessage("")
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unknown error"
      toast.error("Task request failed", { description: message })
      setErrorMessage(message)
    },
  })

  function handleSend() {
    const trimmed = path.trim()
    const normalizedPath =
      trimmed === "" ? "/" : trimmed.startsWith("/") ? trimmed : `/${trimmed}`
    setErrorMessage("")
    mutation.mutate({
      method,
      path: normalizedPath,
      ...(method === "POST" && body !== ""
        ? { body, contentType: "text/plain" }
        : {}),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Task</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Requests are routed to{" "}
          <span className="font-mono">
            {actor.name}.{actor.atespace}.actors.resources.substrate.ate.dev
          </span>{" "}
          via the atenet router.
        </p>
        <div className="flex gap-2">
          <Select
            value={method}
            onValueChange={(value) => setMethod(value as "GET" | "POST")}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="flex-1 font-mono text-xs"
            placeholder="/"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                handleSend()
              }
            }}
          />
          <Button onClick={handleSend} disabled={mutation.isPending}>
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send
          </Button>
        </div>
        {method === "POST" && (
          <Textarea
            className="min-h-28 font-mono text-xs"
            placeholder="request body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        )}
        {mutation.isPending && (
          <p className="text-xs text-muted-foreground">
            Sending… the first request to a suspended actor may take a few
            seconds while it resumes.
          </p>
        )}
        {errorMessage !== "" ? (
          <p className="text-sm break-words text-destructive">{errorMessage}</p>
        ) : (
          response && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={statusClasses(response.status)}
                >
                  {response.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {response.contentType}
                </span>
              </div>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap">
                {response.body}
              </pre>
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}
