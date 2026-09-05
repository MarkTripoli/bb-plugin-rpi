# Comment XML Format

Artifact comments are provided to agents as XML-like blocks.

## Single Comment

```xml
<comment id="abc123">
Author Name: Comment text.
</comment>
```

## Comment With Artifact Context

```xml
<comment id="abc123">
  | previous artifact line
> | artifact line under discussion
  | following artifact line

Author Name: Comment text.
</comment>
```

## Threaded Replies

```xml
<comment id="abc123">
> | artifact text

Alice: Initial comment.
  Bob: Reply.
  Alice: Follow-up.
</comment>
```

## Resolved Comments

Resolved comments are marked in the author line:

```xml
<comment id="abc123">
Alice [RESOLVED]: Completed item.
</comment>
```
