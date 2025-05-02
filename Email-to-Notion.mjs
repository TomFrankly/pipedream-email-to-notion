/** To Do
 * 
 * X Allow user to choose from subject line or first line of email body as the title of the Notion page (as fallback if "name" property is not present in email body)
 * X Allow user to choose if page title is followed/preceded by a ✉️ emoji
 * X Make date parsing more robust with error handling
 * X Add support for "label" property
 * X Add support for "priority" property
 * X Add support for "smart list" property
 * X Add support for "status" property
 * X Add support for "tag" property
 */

import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import * as chrono from 'chrono-node'

export default defineComponent({
    props: {
        fallbackTitle: {
            type: 'string',
            label: 'Fallback Title',
            description: `The title of the Notion page if the "name" property is not present in the email body.\n\n If a line of text like "Name: [Some Text]" is present, [Some Text] will be used as the title – otherwise, the choice you make here will be used.`,
            options: [
                {
                    label: 'Subject Line',
                    value: 'subject'
                },
                {
                    label: 'First Line of Email Body',
                    value: 'body'
                }
            ],
            default: 'subject',
            optional: true
        },
        mailEmoji: {
            type: 'string',
            label: 'Mail Emoji',
            description: 'Choose whether to place a mail emoji (✉️) before or after your Notion page title or to omit it. Defaults to "before".',
            default: 'before',
            options: [
                {
                    label: 'Before',
                    value: 'before'
                },
                {
                    label: 'After',
                    value: 'after'
                },
                {
                    label: 'Omit',
                    value: 'omit'
                }
            ],
            default: "before",
            optional: true
        },
        dateFormat: {
            type: 'string',
            label: 'Date Format',
            description: 'Choose between MM/DD/YYYY (US) or DD/MM/YYYY (European) format for parsing dates. Defaults to US. No matter your choice here, you can also use relative dates like "tomorrow" or "next week".',
            options: [
                {
                    label: 'MM/DD/YYYY (US)',
                    value: 'us'
                },
                {
                    label: 'DD/MM/YYYY (European)',
                    value: 'eu'
                }
            ],
            default: 'us',
            optional: true
        }
    },
    async run({ steps, $ }) {
        const html = steps.trigger.event.body.html
        const ch = cheerio.load(html)

        // Get email subject line
        const subjectLine = steps.trigger.event.headers.subject
        const emailSubject = subjectLine
            .replace(/Subject:\s*/i, '')
            .replace(/^FWD:\s*/i, '')
            .replace(/^FW:\s*/i, '')
            .trim()

        // Common tracking domains
        const trackingDomains = [
            'open.convertkit', 'mailchimp', 'sendgrid', 'mailgun',
            'customerio', 'klaviyo', 'hubspot', 'marketo', 'salesforce',
            'mailerlite', 'constantcontact', 'aweber', 'getresponse',
            'activecampaign', 'drip', 'sendinblue', 'autopilot'
        ]

        // Common tracking patterns in URLs
        const trackingPatterns = [
            '/imp?', '/pixel', '/track', '/open', '/wf/open',
            'beacon', 'analytics', 'tracking', 'counter', 'monitor',
            '1x1.gif', '1x1.png', 'spacer.gif', 'blank.gif',
            'elink.mail', // Add mail tracking domains
            'cdn-cgi/image' // Add CDN tracking paths
        ]

        // Remove unwanted elements
        ch('style, script, head').remove()
        ch('img[src*="pixel"], img[src*="imp"]').remove()

        // Remove tracking images with specific criteria
        ch('img').each((i, elem) => {
            const $img = ch(elem)
            const src = $img.attr('src') || ''
            const alt = $img.attr('alt') || ''
            const title = $img.attr('title') || ''
            const width = $img.attr('width') || ''
            const height = $img.attr('height') || ''

            // Remove if:
            // 1. No alt text and comes after unsubscribe link
            // 2. From known tracking domains
            // 3. Has specific patterns in URL
            // 4. Tiny dimensions (common for tracking pixels)
            // 5. Empty or suspicious alt/title text patterns
            if (
                ((!alt || alt === '') && $img.parents().find('a:contains("Unsubscribe")').length > 0) ||
                trackingDomains.some(domain => src.toLowerCase().includes(domain)) ||
                trackingPatterns.some(pattern => src.toLowerCase().includes(pattern)) ||
                (width === '1' && height === '1') ||
                (width === '0' && height === '0') ||
                /^(spacer|pixel|blank|tracking|open)$/i.test(alt) ||
                /^(spacer|pixel|blank|tracking|open)$/i.test(title)
            ) {
                $img.remove()
            }
        })

        // Explicitly handle line breaks for metadata fields
        ch('p[dir="auto"]').each((i, elem) => {
            const text = ch(elem).text().trim()
            if (text.match(/^(Name|Due|Email Link):/)) {
                ch(elem).after('\n\n')
            }
        })

        const cleanedHtml = ch.html()

        // Configure Turndown
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        })

        // Add custom rule for images

        turndownService.addRule('images', {
            filter: ['img'],
            replacement: function (content, node) {
                const alt = node.getAttribute('alt') || ''
                let src = node.getAttribute('src')
                
                // Skip if it's likely a tracking pixel
                if (trackingPatterns.some(pattern => src.toLowerCase().includes(pattern))) {
                    return ''
                }

                // Fix malformed CDN URLs
                src = src.replace('quality€', 'quality=90')
                
                // Known CDN patterns that need extensions
                const cdnPatterns = {
                    'filekitcdn.com': '.jpg',
                    'imagecdn.convertkit.com': '.jpg',
                    'embed.filekitcdn.com': '.jpg',
                    'cdn.substack.com': '.jpg',
                    'mailchimp.com': '.jpg',
                    'sendgrid.net': '.jpg',
                    'campaign-archive.com': '.jpg',
                    'cloudfront.net': '.jpg',
                    'imgix.net': '.jpg',
                    'amazonaws.com': '.jpg',
                    'customeriomail.com': '.jpg',
                    'mailgun.net': '.jpg',
                    'sendibm1.com': '.jpg',
                    'klaviyo-images.com': '.jpg',
                    'constantcontact.com': '.jpg',
                    'getresponse.com': '.jpg',
                    'activehosted.com': '.jpg',
                    'omnisrc.com': '.jpg',
                    'hubspotusercontent.net': '.jpg',
                    'cmail.com': '.jpg',
                    'awesomescreenshot.com': '.jpg',
                    'cloudinary.com': '.jpg'
                }

                // Add file extension if missing
                for (const [domain, extension] of Object.entries(cdnPatterns)) {
                    if (src.includes(domain) && !src.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
                        src = `${src}${extension}`
                        break
                    }
                }

                // Only return image markdown if we have a valid image URL
                if (src && !src.includes('undefined')) {
                    return `![${alt}](${src})`
                }
                return ''
            }
        })


        let markdown = turndownService.turndown(cleanedHtml)

        // Clean up Unicode characters
        markdown = markdown.replace(/[\u200B\u2007\u034F\u00AD]+/g, '')
        markdown = markdown.replace(/\n{3,}/g, '\n\n')

        // Parse metadata fields
        const result = {
            content: markdown
        }

        const metadataFields = ['name', 'due', 'email link', 'label', 'priority', 'smart list', 'status', 'tag']
        const lines = markdown.split('\n')

        // Initialize default name value based on fallback preferences
        let fallbackValue
        if (this.fallbackTitle === 'body') {
            // Get first non-empty line from content that isn't a metadata field
            fallbackValue = markdown
                .split('\n')
                .map(line => line.trim())
                .find(line => {
                    if (!line) return false
                    // Exclude lines that start with any of our metadata field patterns
                    return !metadataFields.some(field => 
                        line.toLowerCase().startsWith(`${field}:`))
                }) || emailSubject
        } else {
            // Default to subject line
            fallbackValue = emailSubject
        }

        // Set initial name with emoji based on mailEmoji setting
        result.name = this.mailEmoji === 'before' ? `✉️ ${fallbackValue}` :
            this.mailEmoji === 'after' ? `${fallbackValue} ✉️` :
            fallbackValue

        // Helper function to parse due date
        const parseDueDate = (dueText, referenceDateString) => {
            if (!dueText || isPlaceholder(dueText)) return null

            console.log('Due Text:', dueText)
            console.log('Reference Date String:', referenceDateString)

            // Extract timezone offset from the ISO string
            const tzMatch = referenceDateString.match(/([+-]\d{2}):(\d{2})$/)
            if (!tzMatch) return null

            // Parse the reference date string directly (it's already in the correct timezone)
            const referenceDate = new Date(referenceDateString)
            console.log('Reference Date:', referenceDate.toISOString())

            // Try parsing as MM/DD/YYYY or DD/MM/YYYY based on format preference
            const dateRegex = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/
            const match = dueText.match(dateRegex)
            if (match) {
                const [_, first, second, yearMatch] = match
                const month = this.dateFormat === 'eu' ? second : first
                const day = this.dateFormat === 'eu' ? first : second
                
                // Handle year variants
                let year
                if (!yearMatch) {
                    // No year provided, use current year
                    year = new Date(referenceDateString).getFullYear().toString()
                } else if (yearMatch.length === 2) {
                    // Two-digit year provided, assume 20XX
                    year = '20' + yearMatch
                } else {
                    // Full year provided
                    year = yearMatch
                }
                
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
            }

            // Parse with chrono using the reference date
            const parsed = chrono.parseDate(dueText, referenceDate, { forwardDate: true })
            if (parsed) {
                console.log('Chrono Parse Result:', parsed)
                
                // Extract the timezone offset in minutes
                const [_, tzHours, tzMinutes] = tzMatch
                const tzOffsetMinutes = (parseInt(tzHours) * 60) + (parseInt(tzMinutes) * Math.sign(parseInt(tzHours)))
                
                // Adjust the parsed date back to the original timezone
                const adjustedDate = new Date(parsed.getTime() + (tzOffsetMinutes * 60000))
                console.log('Timezone Adjusted Result:', adjustedDate.toISOString())
                
                // Return just the date portion
                return adjustedDate.toISOString().split('T')[0]
            }

            return null
        }

        // Helper function to validate and standardize smart list
        const validateSmartList = (smartList) => {
            if (!smartList || isPlaceholder(smartList)) return null
            const normalized = smartList.toLowerCase().trim()
            
            const smartListMap = {
                'donext': 'Do Next',
                'dn': 'Do Next',
                'do': 'Do Next',
                'do next': 'Do Next',
                'delegated': 'Delegated',
                'del': 'Delegated',
                'someday': 'Someday',
                'some': 'Someday',
                's': 'Someday'
            }
            
            return smartListMap[normalized] || null
        }

        // Helper function to validate and standardize priority
        const validatePriority = (priority) => {
            if (!priority || isPlaceholder(priority)) return null
            const normalized = priority.toLowerCase().trim()
            
            const priorityMap = {
                'high': 'High',
                'h': 'High',
                'p1': 'High',
                'medium': 'Medium',
                'm': 'Medium',
                'p2': 'Medium',
                'low': 'Low',
                'l': 'Low',
                'p3': 'Low'
            }
            
            return priorityMap[normalized] || null
        }

        // Helper function to validate and standardize status
        const validateStatus = (status) => {
            if (!status || isPlaceholder(status)) return null
            const normalized = status.toLowerCase().trim()
            
            const statusMap = {
                'to do': 'To Do',
                'todo': 'To Do',
                'td': 'To Do',
                'doing': 'Doing',
                'done': 'Done'
            }
            
            return statusMap[normalized] || null
        }

        // Helper function to check if a value is a placeholder (anything between curly braces)
        const isPlaceholder = (value) => {
            return /^\{[^}]*\}$/.test(value)
        }

        lines.forEach(line => {
            metadataFields.forEach(field => {
                const pattern = new RegExp(`^${field}:\\s*(.+)?$`, 'i')
                const match = line.match(pattern)
                if (match) {
                    const value = (match[1] || '').trim().replace(/\.+$/, '')

                    switch (field) {
                        case 'name':
                            // Only override the fallback if we have a valid name property
                            if (value && !isPlaceholder(value)) {
                                result[field] = this.mailEmoji === 'before' ? `✉️ ${value}` :
                                    this.mailEmoji === 'after' ? `${value} ✉️` :
                                    value
                            }
                            break
                        
                        case 'due':
                            // Pass the raw timezone string instead of creating a Date object
                            const tzValue = steps.get_current_time_in_specific_timezone.$return_value
                            console.log('Timezone Return Value:', tzValue)
                            result[field] = parseDueDate(value, tzValue)
                            console.log('Final Due Date Result:', result[field])
                            break
                        
                        case 'email link':
                            if (!value || isPlaceholder(value)) {
                                result[field] = null
                            } else {
                                // Check if it's a markdown link [text](url)
                                const markdownLinkMatch = value.match(/\[.*?\]\((.*?)\)/)
                                result[field] = markdownLinkMatch ? markdownLinkMatch[1].trim() : value.trim()
                            }
                            break
                        
                        case 'priority':
                            result[field] = validatePriority(value)
                            break
                        
                        case 'status':
                            result[field] = validateStatus(value)
                            break
                        
                        case 'smart list':
                            result[field] = validateSmartList(value)
                            break
                        
                        case 'label':
                            // Handle label - return null if empty, otherwise return array of trimmed values
                            if (!value || isPlaceholder(value)) {
                                result[field] = null
                            } else {
                                // Split by commas, trim each value, and filter out empty strings
                                result[field] = value
                                    .split(',')
                                    .map(label => label.trim())
                                    .filter(label => label.length > 0)
                            }
                            break
                        
                        case 'tag':
                            result[field] = (!value || isPlaceholder(value)) ? null : value.trim()
                            break
                    }
                } else {
                    // If the field isn't found in the email, set it to null
                    if (!result[field]) {
                        result[field] = null
                    }
                }
            })
        })

        return result
    },
})
