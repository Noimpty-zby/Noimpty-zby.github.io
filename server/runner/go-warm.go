// Built once while making the runner image so /opt/go-cache holds the compiled standard
// library packages practice code usually imports. Without it every run starts from an empty
// GOCACHE and rebuilds the runtime and fmt first (about 20 s on the server).
package main

import (
	_ "bufio"
	_ "bytes"
	_ "container/heap"
	_ "container/list"
	_ "errors"
	_ "fmt"
	_ "math"
	_ "math/rand"
	_ "os"
	_ "slices"
	_ "sort"
	_ "strconv"
	_ "strings"
	_ "sync"
	_ "time"
	_ "unicode"
)

func main() {}
