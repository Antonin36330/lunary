import { useCurrentApp, useProfile, useTemplates } from "@/utils/dataHooks"
import {
  Badge,
  Button,
  Card,
  CheckIcon,
  Grid,
  Group,
  List,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core"
import { useHotkeys, useLocalStorage } from "@mantine/hooks"
import { useSupabaseClient } from "@supabase/auth-helpers-react"
import {
  IconBolt,
  IconCheck,
  IconDeviceFloppy,
  IconDevicesShare,
  IconInfoCircle,
} from "@tabler/icons-react"
import { useRouter } from "next/router"
import { useEffect, useMemo, useState } from "react"
import analytics from "../../utils/analytics"
import { openUpgrade } from "@/components/Layout/UpgradeModal"
import HotkeysInfo from "@/components/Blocks/HotkeysInfo"
import TemplateInputArea from "@/components/Blocks/Prompts/TemplateInputArea"
import TemplateList, {
  defaultTemplate,
} from "@/components/Blocks/Prompts/TemplateMenu"
import { notifications } from "@mantine/notifications"

const availableModels = [
  "gpt-4-1106-preview",
  "gpt-4-vision-preview",
  "gpt-4",
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-1106",
  "gpt-3.5-turbo-16k",
  "openai/gpt-4-32k",
  "claude-2",
  "claude-2.0",
  "claude-instant-v1",
  "open-orca/mistral-7b-openorca",
  "mistralai/mistral-7b-instruct",
  "teknium/openhermes-2.5-mistral-7b",
  "perplexity/pplx-70b-chat",
  "perplexity/pplx-7b-chat",
  "openchat/openchat-7b",
  "google/palm-2-chat-bison",
  "meta-llama/llama-2-13b-chat",
  "meta-llama/llama-2-70b-chat",
]

function createChunkDecoder() {
  const decoder = new TextDecoder()

  return function (chunk: Uint8Array | undefined): string {
    if (!chunk) return ""
    return decoder.decode(chunk, { stream: true })
  }
}

function convertOpenAImessage(msg) {
  return {
    role: msg.role.replace("assistant", "ai"),
    content: msg.content,
    functionCall: msg.function_call,
    toolsCall: msg.tools_call,
  }
}
const ParamItem = ({ name, value }) => (
  <Group justify="space-between">
    <Text size="sm">{name}</Text>
    {typeof value === "string" || typeof value === "number" ? (
      <Text size="sm">{value}</Text>
    ) : (
      value
    )}
  </Group>
)

// const FEATURE_LIST = [
//   "Edit captured requests live",
//   "Optimize prompts",
//   "Share results with your team",
//   "Test brand-new models such as Mistral, Claude v2, Bison & more.",
// ]

function Playground() {
  const router = useRouter()
  const supabaseClient = useSupabaseClient()
  const [template, setTemplate] = useLocalStorage({
    key: "template",
    defaultValue: defaultTemplate,
  })

  const [templateVersion, setTemplateVersion] = useState({
    key: "tp-version",
    // defaultValue:
  })

  const [hasChanges, setHasChanges] = useState(false)

  const { insertVersion, mutate, updateVersion } = useTemplates()

  const [streaming, setStreaming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [output, setOutput] = useState(null)
  const [error, setError] = useState(null)

  useHotkeys([
    [
      "mod+S",
      () => {
        if (hasChanges) saveTemplate()
      },
    ],
    [
      "mod+Enter",
      () => {
        if (!streaming) runPlayground()
      },
    ],
  ])

  const { profile, mutate: revalidateProfile } = useProfile()

  const { app } = useCurrentApp()

  useEffect(() => {
    const { clone, id } = router.query

    // check if we want to clone an existing run
    if (id) {
      const fetchTemplate = async () => {
        setLoading(true)
        const { data } = await supabaseClient
          .from("template_version")
          .select("*,template:template_id(id,slug,mode,name)")
          .eq("id", id)
          .single()
          .throwOnError()

        if (data) {
          setTemplateVersion(data)
          setTemplate(data.template)
        }

        setLoading(false)
      }

      fetchTemplate()
    } else if (clone) {
      const fetchRun = async () => {
        setLoading(true)
        const { data } = await supabaseClient
          .from("run")
          .select("*")
          .eq("id", clone)
          .single()
          .throwOnError()

        if (!Array.isArray(data.input)) data.input = [data.input]

        if (data) {
          setTemplateVersion({ ...templateVersion, content: data.input })
        }

        setLoading(false)
        // remove the id from t

        router.push("/prompts")
      }

      fetchRun()
    }
  }, [])

  // Save as draft without deploying
  const saveTemplate = async () => {
    if (templateVersion.is_draft) {
      console.log(`updating version`)
      await updateVersion(templateVersion)
    } else {
      console.log(`inserting version`)
      const newVersion = await insertVersion([
        {
          template_id: template?.id,
          test_values: templateVersion.test_values,
          content: templateVersion.content,
          extra: templateVersion.extra,
          is_draft: true,
        },
      ])

      console.log(`newVersion`, newVersion)

      if (newVersion) {
        setTemplateVersion(newVersion[0])
      }
    }

    mutate()
  }

  // Deploy the template
  const commitTemplate = async () => {
    if (templateVersion.is_draft) {
      await updateVersion({
        id: templateVersion.id,
        is_draft: false,
      })
    } else {
      const newVersion = await insertVersion([
        {
          template_id: template?.id,
          test_values: templateVersion.test_values,
          content: templateVersion.content,
          extra: templateVersion.extra,
        },
      ])

      if (newVersion) {
        setTemplateVersion(newVersion[0])
      }
    }

    notifications.show({
      title: "Template deployed",
      icon: <IconCheck size={24} />,
      message: "A new version of your template is now being served.",
      color: "teal",
    })

    mutate()
  }

  const runPlayground = async () => {
    const model = template.extra?.model

    analytics.track("RunPlayground", {
      model,
      appId: app?.id,
    })

    if (profile.org?.play_allowance <= 0) {
      openUpgrade("playground")
    }

    setStreaming(true)

    try {
      const fetchResponse = await fetch("/api/generation/playground", {
        method: "POST",
        body: JSON.stringify({
          content: templateVersion.content,
          extra: templateVersion.extra,
          testValues: templateVersion.test_values,
          appId: app?.id,
        }),
      })

      const reader = fetchResponse.body.getReader()

      let streamedResponse = ""
      let responseMessage = {
        content: "",
        role: "assistant",
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        // Update the chat state with the new message tokens.
        streamedResponse += createChunkDecoder()(value)

        if (streamedResponse.startsWith('{"function_call":')) {
          // While the function call is streaming, it will be a string.
          responseMessage["function_call"] = streamedResponse
        } else {
          responseMessage["content"] = streamedResponse
        }

        setOutput(convertOpenAImessage(responseMessage))

        // The request has been aborted, stop reading the stream.
        // if (abortControllerRef.current === null) {
        // reader.cancel()
        // break
        // }
      }

      if (streamedResponse.startsWith('{"function_call":')) {
        // Once the stream is complete, the function call is parsed into an object.
        const parsedFunctionCall = JSON.parse(streamedResponse).function_call

        responseMessage["function_call"] = parsedFunctionCall

        setOutput(convertOpenAImessage(responseMessage))
      }
    } catch (e) {
      console.error(e)
      setError(e)
    }

    revalidateProfile()

    setStreaming(false)
  }

  const switchTemplateVersion = (v) => {
    setTemplateVersion(v)
    router.push(`/prompts/${v.id}`)
  }

  const extraHandler = (key) => ({
    value: templateVersion?.extra?.[key],
    onChange: (value) => {
      setHasChanges(true)
      setTemplateVersion({
        ...templateVersion,
        extra: { ...template.extra, [key]: value },
      })
    },
  })

  // Parse variables from the content template (handlebars parsing)
  const variables = useMemo(() => {
    const variables = {}
    const variableRegex = /{{([^}]+)}}/g
    let contentArray = Array.isArray(templateVersion?.content)
      ? templateVersion?.content
      : [templateVersion?.content]

    contentArray.forEach((message) => {
      let match
      let messageText = typeof message === "string" ? message : message?.content
      while ((match = variableRegex.exec(messageText)) !== null) {
        variables[match[1].trim()] = ""
      }
    })

    return variables
  }, [templateVersion])

  return (
    <Grid
      w="100%"
      overflow="hidden"
      styles={{
        inner: {
          height: "calc(100vh - var(--navbar-size))",
        },
      }}
    >
      <Grid.Col
        span={2}
        style={{ borderRight: "1px solid rgba(120, 120, 120, 0.1)" }}
      >
        <TemplateList
          activeTemplate={template}
          switchTemplate={setTemplate}
          activeVersion={templateVersion}
          switchTemplateVersion={switchTemplateVersion}
        />
      </Grid.Col>
      <Grid.Col
        span={7}
        p="xl"
        style={{ borderRight: "1px solid rgba(120, 120, 120, 0.1)" }}
      >
        <TemplateInputArea
          loading={loading}
          template={templateVersion}
          setTemplate={setTemplateVersion}
          saveTemplate={saveTemplate}
          setHasChanges={setHasChanges}
          output={output}
          error={error}
        />
      </Grid.Col>
      <Grid.Col span={3} p="xl">
        <Stack style={{ zIndex: 0 }}>
          <Group>
            <Button
              leftSection={<IconDevicesShare size={18} />}
              size="sm"
              loading={loading}
              disabled={loading || (template?.id && !hasChanges)}
              variant="outline"
              rightSection={
                <HotkeysInfo hot="S" size="sm" style={{ marginTop: -4 }} />
              }
              onClick={saveTemplate}
            >
              Save changes
            </Button>

            <Button
              leftSection={<IconDeviceFloppy size={18} />}
              size="sm"
              loading={loading}
              disabled={loading || (template?.id && !hasChanges)}
              variant="filled"
              onClick={commitTemplate}
            >
              Deploy
            </Button>
            {/* <Button
              leftSection={<IconHelp size={18} />}
              size="xs"
              variant="outline"
            >
              How to use
            </Button> */}
          </Group>

          <ParamItem
            name="Slug"
            value={
              <TextInput
                size="xs"
                w={220}
                radius="sm"
                pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$ "
                placeholder="Template name"
                value={template?.slug}
                onChange={(e) => {
                  setHasChanges(true)
                  setTemplate({
                    ...template,
                    slug: e.currentTarget.value,
                  })
                }}
              />
            }
          />

          <ParamItem
            name="Template Mode"
            value={
              <SegmentedControl
                size="xs"
                data={[
                  {
                    value: "openai",
                    label: "OpenAI",
                  },
                  {
                    value: "custom",
                    label: "Custom Chat",
                  },
                  {
                    value: "text",
                    label: "Text",
                  },
                ]}
                value={template?.mode}
                // onChange={(value) => {
                //   const newTemplate = { ...template, mode: value }
                //   if (template?.mode === "text" && value !== "text") {
                //     // Switching from text to custom/openai
                //     newTemplate.content = [
                //       { role: "user", content: template.content },
                //     ]
                //   } else if (template?.mode !== "text" && value === "text") {
                //     // Switching from custom/openai to text
                //     const firstUserMessage = template.content[0]

                //     console.log(`firstUserMessage`, firstUserMessage)

                //     newTemplate.content = firstUserMessage?.content || ""
                //   }
                //   setTemplate(newTemplate)
                // }}
              />
            }
          />

          {template?.mode !== "text" && (
            <>
              <ParamItem
                name="Model"
                value={
                  <Select
                    size="xs"
                    data={availableModels.filter((model) =>
                      template?.mode === "openai"
                        ? model.includes("gpt-")
                        : true,
                    )}
                    w={250}
                    searchable
                    autoCorrect="off"
                    inputMode="search"
                    {...extraHandler("model")}
                  />
                }
              />

              <ParamItem
                name="Temperature"
                value={
                  <NumberInput
                    min={0}
                    max={2}
                    defaultValue={1.0}
                    step={0.1}
                    decimalScale={2}
                    size="xs"
                    style={{ zIndex: 0 }}
                    w={90}
                    {...extraHandler("temperature")}
                  />
                }
              />

              <ParamItem
                name="Max tokens"
                value={
                  <NumberInput
                    min={1}
                    defaultValue={1000}
                    max={32000}
                    step={100}
                    size="xs"
                    w={90}
                    {...extraHandler("max_tokens")}
                  />
                }
              />

              <ParamItem
                name="Freq. Penalty"
                value={
                  <NumberInput
                    min={-2}
                    max={2}
                    defaultValue={0}
                    decimalScale={2}
                    step={0.1}
                    size="xs"
                    w={90}
                    {...extraHandler("frequency_penalty")}
                  />
                }
              />

              <ParamItem
                name="Pres. Penalty"
                value={
                  <NumberInput
                    min={-2}
                    max={2}
                    decimalScale={2}
                    step={0.1}
                    defaultValue={0}
                    size="xs"
                    w={90}
                    {...extraHandler("presence_penalty")}
                  />
                }
              />

              <ParamItem
                name="Top P"
                value={
                  <NumberInput
                    min={0.1}
                    max={1}
                    defaultValue={1}
                    decimalScale={2}
                    step={0.1}
                    size="xs"
                    w={90}
                    {...extraHandler("top_p")}
                  />
                }
              />
            </>
          )}

          {template && (
            <Card shadow="sm" p="sm" my="md">
              <Group mb="md" align="center" justify="space-between">
                <Text size="sm" fw="bold">
                  Variables
                </Text>
                <Tooltip label="Add variables to your template in the handlebars format {{variable}}">
                  <IconInfoCircle size={16} />
                </Tooltip>
              </Group>
              {!Object.keys(variables).length && (
                <Text c="dimmed" size="sm">
                  {`Add variables to your template: {{variable}}`}
                </Text>
              )}
              <Stack>
                {Object.keys(variables).map((variable) => (
                  <Group
                    key={variable}
                    align="center"
                    justify="space-between"
                    gap={0}
                  >
                    <Badge
                      key={variable}
                      maw={90}
                      variant="outline"
                      style={{ textTransform: "none" }}
                    >
                      {variable}
                    </Badge>
                    <Textarea
                      size="xs"
                      w={220}
                      radius="sm"
                      rows={1}
                      placeholder="Test Value"
                      value={templateVersion?.test_values?.[variable]}
                      onChange={(e) => {
                        setTemplateVersion({
                          ...templateVersion,
                          test_values: {
                            ...templateVersion.test_values,
                            [variable]: e.currentTarget.value,
                          },
                        })
                      }}
                    />
                  </Group>
                ))}
              </Stack>
            </Card>
          )}

          {template?.mode !== "text" && (
            <Button
              leftSection={<IconBolt size="16" />}
              size="sm"
              disabled={loading}
              onClick={runPlayground}
              loading={streaming}
              rightSection={
                <HotkeysInfo hot="Enter" size="sm" style={{ marginTop: -4 }} />
              }
            >
              Run
            </Button>
          )}
        </Stack>
      </Grid.Col>
    </Grid>
  )
}

export default Playground
